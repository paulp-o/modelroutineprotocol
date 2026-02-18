type EntrypointType = "sh" | "ts" | "py";

type EntrypointSkeleton = {
  filename: string;
  content: string;
};

export function generateEntrypoint(
  type: EntrypointType,
  goal: string,
): EntrypointSkeleton {
  if (type === "sh") {
    return {
      filename: "run.sh",
      content: `#!/usr/bin/env bash
set -euo pipefail
# Goal: ${goal}

echo "TODO: implement routine"
`,
    };
  }

  if (type === "ts") {
    return {
      filename: "run.ts",
      content: `// Goal: ${goal}

console.log("TODO: implement routine");
`,
    };
  }

  return {
    filename: "run.py",
    content: `#!/usr/bin/env python3
"""Goal: ${goal}"""

print("TODO: implement routine")
`,
  };
}
