import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { balance, connect, getFixture, post, setContext, tx, type Fixture } from "./helpers/db";

let app: Client;
let owner: Client;
let f: Fixture;

beforeAll(async () => {
  f = await getFixture();
  app = await connect("app");
  owner = await connect("owner");
});
afterAll(async () => {
  await app.end();
  await owner.end();
});

describe("database roles and immutability", () => {
  it("app role cannot create tables", async () => {
    await expect(app.query("CREATE TABLE hack (x int)")).rejects.toThrow(/permission denied/);
  });

  it("app role cannot UPDATE or DELETE journal rows", async () => {
    let id = "";
    expect(await tx(app, async () => {
      id = await post(app, f, "OWNER_CAPITAL", "2026-11-01", [{ acct: "1100", dr: "100.00" }, { acct: "3200", cr: "100.00" }]);
    })).toBeNull();
    await expect(app.query("UPDATE journal_lines SET debit = 1 WHERE entry_id = $1", [id])).rejects.toThrow(/permission denied/);
    await expect(app.query("DELETE FROM journal_entries WHERE id = $1", [id])).rejects.toThrow(/permission denied/);
  });

  it("even the table owner cannot UPDATE / DELETE / TRUNCATE fact tables (trigger)", async () => {
    await expect(owner.query("UPDATE journal_lines SET debit = debit")).rejects.toThrow(/IMMUTABLE/);
    await expect(owner.query("DELETE FROM journal_lines")).rejects.toThrow(/IMMUTABLE/);
    await expect(owner.query("TRUNCATE journal_lines CASCADE")).rejects.toThrow(/IMMUTABLE/);
    await expect(owner.query("DELETE FROM audit_log")).rejects.toThrow(/IMMUTABLE/);
  });

  it("configuration rows can be edited but never deleted", async () => {
    await expect(app.query("UPDATE settings SET value = '\"10.00\"' WHERE key = 'cash_rounding_tolerance'")).resolves.toBeTruthy();
    await expect(app.query("DELETE FROM settings WHERE key = 'cash_rounding_tolerance'")).rejects.toThrow(/permission denied|IMMUTABLE/);
    await expect(owner.query("DELETE FROM payment_modes WHERE code = 'OTHER'")).rejects.toThrow(/IMMUTABLE/);
  });

  it("backup role is read-only", async () => {
    const b = await connect("backup");
    try {
      await expect(b.query("SELECT count(*) FROM journal_entries")).resolves.toBeTruthy();
      await expect(b.query("INSERT INTO settings (key, value) VALUES ('x','1')")).rejects.toThrow(/permission denied/);
    } finally {
      await b.end();
    }
  });

  it("every insert is audited with the app user id", async () => {
    let entryId = "";
    expect(await tx(app, async () => {
      await setContext(app, f.ownerId, "req-audit-1");
      entryId = await post(app, f, "OWNER_CAPITAL", "2026-11-01", [{ acct: "1100", dr: "5.00" }, { acct: "3200", cr: "5.00" }]);
    })).toBeNull();
    const r = await app.query("SELECT user_id, request_id FROM audit_log WHERE table_name = 'journal_entries' AND record_id = $1", [entryId]);
    expect(r.rows).toEqual([{ user_id: f.ownerId, request_id: "req-audit-1" }]);
  });
});

describe("payment modes", () => {
  it("customer credit is only a sales-settlement mode, never a receipt or payment mode (C12)", async () => {
    const r = await app.query("SELECT allowed_on_receipt, allowed_on_payment, allowed_on_sales_split FROM payment_modes WHERE code = 'CUSTOMER_CREDIT'");
    expect(r.rows[0]).toEqual({ allowed_on_receipt: false, allowed_on_payment: false, allowed_on_sales_split: true });
    await expect(app.query("UPDATE payment_modes SET allowed_on_receipt = true WHERE code = 'CUSTOMER_CREDIT'")).rejects.toThrow(/check constraint/);
  });
});

describe("journal integrity", () => {
  const D = "2026-11-02";

  it("accepts a balanced entry", async () => {
    expect(await tx(app, async () => {
      await post(app, f, "EXPENSE_PAYMENT", D, [{ acct: "6400", dr: "550.00" }, { acct: "1100", cr: "550.00" }]);
    })).toBeNull();
  });

  it("rejects an unbalanced entry at commit", async () => {
    const err = await tx(app, async () => {
      await post(app, f, "EXPENSE_PAYMENT", D, [{ acct: "6400", dr: "550.00" }, { acct: "1100", cr: "500.00" }]);
    });
    expect(err).toMatch(/UNBALANCED/);
  });

  it("rejects an entry with a single line or no lines", async () => {
    expect(await tx(app, async () => {
      await post(app, f, "EXPENSE_PAYMENT", D, [{ acct: "6400", dr: "1.00" }]);
    })).toMatch(/UNBALANCED/);
    expect(await tx(app, async () => {
      await post(app, f, "EXPENSE_PAYMENT", D, []);
    })).toMatch(/UNBALANCED/);
  });

  it("rejects a line with both debit and credit, or zero", async () => {
    expect(await tx(app, async () => {
      await post(app, f, "EXPENSE_PAYMENT", D, [{ acct: "6400", dr: "1.00", cr: "1.00" }, { acct: "1100", cr: "0" }]);
    })).toMatch(/check constraint/);
  });
});

describe("posting rules prevent double counting (Part 17-G)", () => {
  const D = "2026-11-03";
  const cust = () => ["CUSTOMER", f.customerId] as [string, string];

  it("a customer repayment cannot be posted as fuel revenue", async () => {
    const err = await tx(app, async () => {
      await post(app, f, "CUSTOMER_REPAYMENT", D, [{ acct: "1100", dr: "5000.00" }, { acct: "4110", cr: "5000.00" }]);
    });
    expect(err).toMatch(/POSTING_RULE/);
  });

  it("a supplier payment cannot be posted as an expense", async () => {
    const err = await tx(app, async () => {
      await post(app, f, "SUPPLIER_PAYMENT", D, [{ acct: "6500", dr: "10000.00" }, { acct: "1100", cr: "10000.00" }]);
    });
    expect(err).toMatch(/POSTING_RULE/);
  });

  it("an opening balance cannot be posted as revenue", async () => {
    const err = await tx(app, async () => {
      await post(app, f, "OPENING_BALANCE", D, [{ acct: "1400", dr: "1000.00", party: cust() }, { acct: "4110", cr: "1000.00" }]);
    });
    expect(err).toMatch(/POSTING_RULE/);
  });

  it("a cash difference cannot be posted as an expense", async () => {
    const err = await tx(app, async () => {
      await post(app, f, "CASH_COUNT_DIFFERENCE", D, [{ acct: "6500", dr: "931.00" }, { acct: "1100", cr: "931.00" }]);
    });
    expect(err).toMatch(/POSTING_RULE/);
  });

  it("an internal transfer cannot touch income or expense", async () => {
    const err = await tx(app, async () => {
      await post(app, f, "BANK_DEPOSIT", D, [{ acct: "6500", dr: "1.00" }, { acct: "1100", cr: "1.00" }]);
    });
    expect(err).toMatch(/POSTING_RULE/);
  });

  it("udhari accounts require a customer", async () => {
    const err = await tx(app, async () => {
      await post(app, f, "CREDIT_SALE", D, [{ acct: "1400", dr: "20000.00" }, { acct: "1900", cr: "20000.00" }]);
    });
    expect(err).toMatch(/requires a CUSTOMER party/);
  });

  it("credit sale then repayment: receivable back to zero, revenue untouched (INV-03)", async () => {
    const revBefore = await balance(app, "4110");
    expect(await tx(app, async () => {
      await post(app, f, "CREDIT_SALE", D, [{ acct: "1400", dr: "20000.00", party: cust() }, { acct: "1900", cr: "20000.00" }]);
      await post(app, f, "CUSTOMER_REPAYMENT", D, [{ acct: "1100", dr: "20000.00" }, { acct: "1400", cr: "20000.00", party: cust() }]);
    })).toBeNull();
    const r = await app.query(
      "SELECT balance::text FROM v_party_balances WHERE party_kind = 'CUSTOMER' AND party_id = $1", [f.customerId]);
    expect(r.rows[0].balance).toBe("0.00");
    expect(await balance(app, "4110")).toBe(revBefore);
  });

  it("trial balance always nets to zero (INV-01)", async () => {
    const r = await app.query("SELECT SUM(balance)::text AS s FROM v_trial_balance");
    expect(r.rows[0].s).toBe("0.00");
  });
});

describe("reversals", () => {
  const D = "2026-11-04";

  it("allows an exact mirror reversal, once", async () => {
    let orig = "";
    expect(await tx(app, async () => {
      orig = await post(app, f, "EXPENSE_PAYMENT", D, [{ acct: "6400", dr: "300.00" }, { acct: "1100", cr: "300.00" }]);
    })).toBeNull();
    expect(await tx(app, async () => {
      await post(app, f, "REVERSAL", D, [{ acct: "1100", dr: "300.00" }, { acct: "6400", cr: "300.00" }], { reverses: orig });
    })).toBeNull();
    expect(await tx(app, async () => {
      await post(app, f, "REVERSAL", D, [{ acct: "1100", dr: "300.00" }, { acct: "6400", cr: "300.00" }], { reverses: orig });
    })).toMatch(/duplicate key|unique/i);
  });

  it("rejects a reversal that does not mirror the original", async () => {
    let orig = "";
    expect(await tx(app, async () => {
      orig = await post(app, f, "EXPENSE_PAYMENT", D, [{ acct: "6400", dr: "300.00" }, { acct: "1100", cr: "300.00" }]);
    })).toBeNull();
    expect(await tx(app, async () => {
      await post(app, f, "REVERSAL", D, [{ acct: "1100", dr: "250.00" }, { acct: "6400", cr: "250.00" }], { reverses: orig });
    })).toMatch(/REVERSAL_MISMATCH/);
  });
});

describe("business day lock", () => {
  const D = "2026-11-05";

  it("follows OPEN -> SUBMITTED -> LOCKED and blocks postings after lock", async () => {
    expect(await tx(app, async () => {
      await post(app, f, "EXPENSE_PAYMENT", D, [{ acct: "6400", dr: "10.00" }, { acct: "1100", cr: "10.00" }]);
    })).toBeNull();
    await expect(app.query(
      "UPDATE business_days SET status = 'LOCKED', locked_by = $2, locked_at = now() WHERE site_id = $1 AND business_date = $3",
      [f.siteId, f.ownerId, D])).rejects.toThrow(/transition OPEN -> LOCKED not allowed/);
    await app.query(
      "UPDATE business_days SET status = 'SUBMITTED', submitted_by = $2, submitted_at = now() WHERE site_id = $1 AND business_date = $3",
      [f.siteId, f.staffId, D]);
    await app.query(
      "UPDATE business_days SET status = 'LOCKED', locked_by = $2, locked_at = now() WHERE site_id = $1 AND business_date = $3",
      [f.siteId, f.ownerId, D]);

    expect(await tx(app, async () => {
      await post(app, f, "EXPENSE_PAYMENT", D, [{ acct: "6400", dr: "10.00" }, { acct: "1100", cr: "10.00" }]);
    })).toMatch(/DAY_LOCKED/);

    await expect(app.query(
      "UPDATE business_days SET status = 'OPEN' WHERE site_id = $1 AND business_date = $2", [f.siteId, D]))
      .rejects.toThrow(/not allowed/);
  });

  it("only the owner can approve a post-lock correction", async () => {
    const D2 = D;
    expect(await tx(app, async () => {
      await post(app, f, "POST_LOCK_CORRECTION", D2, [{ acct: "6400", dr: "1.00" }, { acct: "1100", cr: "1.00" }], { approvedBy: f.staffId });
    })).toMatch(/approved by the owner/);
    expect(await tx(app, async () => {
      await post(app, f, "POST_LOCK_CORRECTION", D2, [{ acct: "6400", dr: "1.00" }, { acct: "1100", cr: "1.00" }], { approvedBy: f.ownerId });
    })).toBeNull();
  });

  it("a lock waits for an in-flight posting (no entry slips in after the lock)", async () => {
    const D3 = "2026-11-06";
    const other = await connect("app");
    // The day row exists (committed) before anyone can lock it, as in real use.
    await app.query("SELECT lock_business_day_for_posting($1, $2)", [f.siteId, D3]);
    try {
      // T1: posting in progress holds FOR SHARE on the day row
      await app.query("BEGIN");
      await post(app, f, "EXPENSE_PAYMENT", D3, [{ acct: "6400", dr: "7.00" }, { acct: "1100", cr: "7.00" }]);
      // T2: tries to lock with NOWAIT -> must fail because T1 holds a share lock
      await other.query("BEGIN");
      await expect(other.query(
        "SELECT 1 FROM business_days WHERE site_id = $1 AND business_date = $2 FOR UPDATE NOWAIT", [f.siteId, D3]))
        .rejects.toThrow(/could not obtain lock/);
      await other.query("ROLLBACK");
      await app.query("COMMIT");
    } finally {
      await other.end();
    }
  });
});
