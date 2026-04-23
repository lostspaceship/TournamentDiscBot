import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "cmd.exe" : "npm",
      process.platform === "win32" ? ["/c", "npm", ...args] : args,
      {
      stdio: "inherit",
      shell: false
      }
    );

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed: npm ${args.join(" ")} (${code ?? "unknown"})`));
    });
  });

const main = async () => {
  try {
    await run(["run", "prisma:generate"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (process.platform !== "win32") {
      throw error;
    }

    const existingEnginePath = "node_modules/.prisma/client/query_engine-windows.dll.node";
    if (!existsSync(existingEnginePath)) {
      throw error;
    }

    console.warn("Normal Prisma generate failed on Windows, using the existing Prisma client because the engine DLL is locked.");
    console.warn(message);
  }
  await run(["run", "build"]);
  await run(["run", "prisma:migrate"]);

  const bot = spawn(process.execPath, ["dist/src/index.js"], {
    stdio: "inherit",
    shell: false
  });

  const forwardSignal = (signal) => {
    if (!bot.killed) {
      bot.kill(signal);
    }
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  bot.on("exit", (code) => {
    process.exit(code ?? 0);
  });
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
