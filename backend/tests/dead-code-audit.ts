import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

function norm(p: string): string {
  return p.replace(/\\/g, "/");
}

function rel(p: string): string {
  return path.relative(ROOT, p).replace(/\\/g, "/");
}

function isFile(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getAllTsFiles(dir: string): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }

      results.push(...getAllTsFiles(full));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      results.push(norm(full));
    }
  }

  return results;
}

function resolveModule(importer: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const base = path.resolve(path.dirname(importer), specifier);

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];

  for (const candidate of candidates) {
    if (isFile(candidate)) {
      return norm(candidate);
    }
  }

  return null;
}

function hasModifierKind(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = (node as any).modifiers;
  return (
    Array.isArray(modifiers) &&
    modifiers.some((m: any) => m.kind === kind)
  );
}

function collectExportNames(sf: ts.SourceFile): {
  exports: Array<{ name: string; isDefault: boolean }>;
  hasExportStar: boolean;
} {
  const exports: Array<{ name: string; isDefault: boolean }> = [];
  let hasExportStar = false;

  function add(name: string, isDefault: boolean) {
    if (!exports.some((e) => e.name === name && e.isDefault === isDefault)) {
      exports.push({ name, isDefault });
    }
  }

  function visit(node: ts.Node) {
    if (ts.isExportAssignment(node)) {
      add("default", true);
    }

    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
          add(el.name.text, el.name.text === "default");
        }
      } else if (!node.exportClause && node.moduleSpecifier) {
        hasExportStar = true;
      }
    }

    const exported = hasModifierKind(node, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifierKind(node, ts.SyntaxKind.DefaultKeyword);

    if (exported) {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node)
      ) {
        if (isDefault) {
          add("default", true);
        } else if (node.name) {
          add(node.name.text, false);
        }
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            add(decl.name.text, isDefault);
          }
        }
      } else if (ts.isModuleDeclaration(node)) {
        if (ts.isIdentifier(node.name)) {
          add(node.name.text, isDefault);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);

  return { exports, hasExportStar };
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error("src folder not found. Run this from the backend folder.");
    process.exit(1);
  }

  const allFiles = getAllTsFiles(SRC);
  const allFileSet = new Set(allFiles);

  const fileTexts = new Map<string, string>();
  const graph = new Map<string, Set<string>>();
  const fileExports = new Map<
    string,
    { exports: Array<{ name: string; isDefault: boolean }>; hasExportStar: boolean }
  >();
  const usedExports = new Map<string, Set<string>>();

  function markUsed(target: string, name: string) {
    if (!usedExports.has(target)) {
      usedExports.set(target, new Set());
    }

    usedExports.get(target)!.add(name);
  }

  for (const file of allFiles) {
    const text = fs.readFileSync(file, "utf8");
    fileTexts.set(file, text);

    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);

    const specs = new Set<string>();

    function visit(node: ts.Node) {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const spec = node.moduleSpecifier.text;
        specs.add(spec);

        const target = resolveModule(file, spec);

        if (target && node.importClause) {
          if (node.importClause.name) {
            markUsed(target, "default");
          }

          const bindings = node.importClause.namedBindings;

          if (bindings) {
            if (ts.isNamespaceImport(bindings)) {
              markUsed(target, "*");
            } else if (ts.isNamedImports(bindings)) {
              for (const el of bindings.elements) {
                const importedName = el.propertyName
                  ? el.propertyName.text
                  : el.name.text;

                markUsed(target, importedName);
              }
            }
          }
        }
      }

      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const spec = node.moduleSpecifier.text;
        specs.add(spec);

        const target = resolveModule(file, spec);

        if (target) {
          if (node.exportClause && ts.isNamedExports(node.exportClause)) {
            for (const el of node.exportClause.elements) {
              const importedName = el.propertyName
                ? el.propertyName.text
                : el.name.text;

              markUsed(target, importedName);
            }
          } else if (!node.exportClause) {
            markUsed(target, "*");
          }
        }
      }

      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const spec = node.arguments[0].text;
        specs.add(spec);

        const target = resolveModule(file, spec);

        if (target) {
          markUsed(target, "*");
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sf);

    const dynamicImportRegex =
      /import\(\s*["']([^"']+)["']\s*\)/g;

    let dynamicMatch: RegExpExecArray | null;

    while ((dynamicMatch = dynamicImportRegex.exec(text)) !== null) {
      const spec = dynamicMatch[1];
      specs.add(spec);

      const target = resolveModule(file, spec);

      if (target) {
        markUsed(target, "*");
      }
    }

    const requireRegex =
      /require\(\s*["']([^"']+)["']\s*\)/g;

    let requireMatch: RegExpExecArray | null;

    while ((requireMatch = requireRegex.exec(text)) !== null) {
      const spec = requireMatch[1];
      specs.add(spec);

      const target = resolveModule(file, spec);

      if (target) {
        markUsed(target, "*");
      }
    }

    const resolved = new Set<string>();

    for (const spec of specs) {
      const target = resolveModule(file, spec);

      if (target) {
        resolved.add(target);
      }
    }

    graph.set(file, resolved);
    fileExports.set(file, collectExportNames(sf));
  }

  const entrypoints = new Set<string>();

  function addEntry(entry: string) {
    const abs = path.isAbsolute(entry)
      ? entry
      : path.join(ROOT, entry);

    if (isFile(abs)) {
      entrypoints.add(norm(abs));
    }
  }

  addEntry("src/index.ts");
  addEntry("src/app.ts");

  for (const file of allFiles) {
    if (file.includes("/src/scripts/")) {
      entrypoints.add(file);
    }
  }

  try {
    const pkgPath = path.join(ROOT, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const scripts = pkg.scripts || {};

    for (const cmd of Object.values(scripts)) {
      const matches = String(cmd).match(/src\/[^\s"']+\.ts/g) || [];

      for (const match of matches) {
        addEntry(match);
      }
    }
  } catch {
    // Ignore package.json read errors.
  }

  const reachable = new Set<string>();
  const queue = [...entrypoints].filter((f) => allFileSet.has(f));

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (reachable.has(current)) {
      continue;
    }

    reachable.add(current);

    const deps = graph.get(current) || new Set();

    for (const dep of deps) {
      if (!reachable.has(dep)) {
        queue.push(dep);
      }
    }
  }

  const unreachableFiles = allFiles
    .filter((file) => !reachable.has(file))
    .map((file) => rel(file))
    .sort();

  const possiblyUnusedExports: Array<{
    file: string;
    exportName: string;
    internalCount: number;
  }> = [];

  for (const file of allFiles) {
    if (!reachable.has(file)) {
      continue;
    }

    if (entrypoints.has(file)) {
      continue;
    }

    const exportInfo = fileExports.get(file);

    if (!exportInfo || exportInfo.hasExportStar) {
      continue;
    }

    const used = usedExports.get(file) || new Set<string>();

    if (used.has("*")) {
      continue;
    }

    const text = fileTexts.get(file) || "";

    for (const exp of exportInfo.exports) {
      if (used.has(exp.name)) {
        continue;
      }

      if (exp.name === "default") {
        possiblyUnusedExports.push({
          file: rel(file),
          exportName: "default",
          internalCount: 0,
        });

        continue;
      }

      const internalRegex = new RegExp(
        `\\b${escapeRegExp(exp.name)}\\b`,
        "g"
      );

      const internalCount = (text.match(internalRegex) || []).length;

      if (internalCount <= 1) {
        possiblyUnusedExports.push({
          file: rel(file),
          exportName: exp.name,
          internalCount,
        });
      }
    }
  }

  possiblyUnusedExports.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.exportName.localeCompare(b.exportName)
  );

  const dependencyKeysNotReferenced: string[] = [];

  const depPath = norm(path.join(SRC, "api", "dependencies.ts"));
  const depText = fileTexts.get(depPath);

  if (depText) {
    const match = depText.match(/deps\s*=\s*{([\s\S]*?)};/);

    if (match) {
      const keys = match[1]
        .split(",")
        .map((part) => part.trim().split(/[:\s]/)[0].trim())
        .filter(Boolean);

      for (const key of keys) {
        const regex = new RegExp(`\\b${escapeRegExp(key)}\\b`);

        let found = false;

        for (const [file, content] of fileTexts.entries()) {
          if (file === depPath) {
            continue;
          }

          if (regex.test(content)) {
            found = true;
            break;
          }
        }

        if (!found) {
          dependencyKeysNotReferenced.push(key);
        }
      }
    }
  }

  dependencyKeysNotReferenced.sort();

  const report = {
    generatedAt: new Date().toISOString(),
    cwd: ROOT,
    entrypoints: [...entrypoints].map((f) => rel(f)).sort(),
    totalSrcFiles: allFiles.length,
    reachableFiles: reachable.size,
    unreachableFiles,
    possiblyUnusedExports,
    dependencyKeysNotReferenced,
    notes: [
      "Unreachable files are strong dead-code candidates.",
      "Possibly unused exports may still be used dynamically or internally.",
      "Dependency keys not referenced are likely initialized but unused.",
      "Do not delete anything until we review the report.",
    ],
  };

  const reportPath = path.join(ROOT, "dead-code-report.json");

  fs.writeFileSync(
    reportPath,
    JSON.stringify(report, null, 2),
    "utf8"
  );

  const maxConsoleItems = 200;

  console.log("==================================================");
  console.log("CONTEXTOS DEAD CODE AUDIT");
  console.log("==================================================");
  console.log("");
  console.log(`Total src files: ${report.totalSrcFiles}`);
  console.log(`Reachable files: ${report.reachableFiles}`);
  console.log(`Unreachable files: ${report.unreachableFiles.length}`);
  console.log(
    `Possibly unused exports: ${report.possiblyUnusedExports.length}`
  );
  console.log(
    `Dependency keys not referenced: ${report.dependencyKeysNotReferenced.length}`
  );
  console.log("");

  console.log("UNREACHABLE FILES");
  console.log("------------------");

  if (report.unreachableFiles.length === 0) {
    console.log("None found.");
  } else {
    report.unreachableFiles
      .slice(0, maxConsoleItems)
      .forEach((file) => console.log(file));

    if (report.unreachableFiles.length > maxConsoleItems) {
      console.log(
        `... and ${report.unreachableFiles.length - maxConsoleItems} more. See dead-code-report.json`
      );
    }
  }

  console.log("");
  console.log("POSSIBLY UNUSED EXPORTS");
  console.log("------------------------");

  if (report.possiblyUnusedExports.length === 0) {
    console.log("None found.");
  } else {
    report.possiblyUnusedExports
      .slice(0, maxConsoleItems)
      .forEach((item) => {
        console.log(
          `${item.file} -> ${item.exportName} (internal references: ${item.internalCount})`
        );
      });

    if (report.possiblyUnusedExports.length > maxConsoleItems) {
      console.log(
        `... and ${report.possiblyUnusedExports.length - maxConsoleItems} more. See dead-code-report.json`
      );
    }
  }

  console.log("");
  console.log("DEPENDENCY KEYS NOT REFERENCED OUTSIDE dependencies.ts");
  console.log("--------------------------------------------------------");

  if (report.dependencyKeysNotReferenced.length === 0) {
    console.log("None found.");
  } else {
    report.dependencyKeysNotReferenced.forEach((key) => {
      console.log(key);
    });
  }

  console.log("");
  console.log(`Report written to: ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});