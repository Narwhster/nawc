import { spawn } from "node-pty";
import { describe, expect, it } from "vitest";

describe("runnable terminal", () => {
  it("provides TTY semantics and forwards user input", async () => {
    const terminal = spawn(
      process.execPath,
      [
        "-e",
        `console.log("tty:" + process.stdin.isTTY);
         console.log("size:" + process.stdout.columns + "x" + process.stdout.rows);
         process.stdin.once("data", data => {
           console.log("input:" + data.toString().trim());
           process.exit(0);
         });`,
      ],
      { cols: 93, cwd: process.cwd(), env: process.env, name: "xterm-256color", rows: 27 },
    );
    let output = "";

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        terminal.kill();
        reject(new Error("Timed out waiting for the terminal process"));
      }, 5_000);
      terminal.onData((data) => {
        output += data;
        if (output.includes("size:93x27")) terminal.write("hello\r");
      });
      terminal.onExit(({ exitCode }) => {
        clearTimeout(timeout);
        if (exitCode === 0) resolve();
        else reject(new Error(`Terminal exited with ${exitCode}`));
      });
    });

    expect(output).toContain("tty:true");
    expect(output).toContain("size:93x27");
    expect(output).toContain("input:hello");
  });
});
