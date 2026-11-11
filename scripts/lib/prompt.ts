import { stdin, stdout } from "node:process";

/** Reads a line from the terminal without echoing it. */
export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(new Error("Run this command in an interactive terminal"));
      return;
    }
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (c === "\u0003") {
          stdin.setRawMode(false);
          process.exit(130);
        }
        if (c === "\u0008" || c === "\u007f") {
          value = value.slice(0, -1);
        } else {
          value += c;
        }
      }
    };
    stdin.on("data", onData);
  });
}
