import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const file = new URL("../dist/mrp.js", import.meta.url);
const shebang = "#!/usr/bin/env node\n";
let current = readFileSync(file, "utf8");

// Strip any existing shebang lines from the bundle output
while (current.startsWith("#!")) {
  const newlineIdx = current.indexOf("\n");
  if (newlineIdx === -1) break;
  current = current.slice(newlineIdx + 1);
}

writeFileSync(file, shebang + current);
chmodSync(file, 0o755);
