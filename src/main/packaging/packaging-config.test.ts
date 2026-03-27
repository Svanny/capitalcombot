import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

describe("packaging configuration", () => {
  it("does not disable native dependency rebuilds in electron-builder", () => {
    const builderConfig = readFileSync(resolve(root, "electron-builder.yml"), "utf8");

    expect(builderConfig).not.toMatch(/^\s*npmRebuild:\s*false\s*$/m);
  });

  it("does not hardcode unsigned release packaging in electron-builder", () => {
    const builderConfig = readFileSync(resolve(root, "electron-builder.yml"), "utf8");

    expect(builderConfig).not.toMatch(/^\s*identity:\s*null\s*$/m);
    expect(builderConfig).not.toMatch(/^\s*sign:\s*false\s*$/m);
  });

  it("rebuilds mac native dependencies before creating the DMG", () => {
    const script = readFileSync(resolve(root, "scripts/package-mac.sh"), "utf8");

    expect(script).toContain('ALLOW_UNSIGNED_PACKAGING');
    expect(script).toContain('CSC_LINK');
    expect(script).toContain('CSC_KEY_PASSWORD');
    expect(script).toContain("electron-builder install-app-deps --platform=darwin");
    expect(script).toContain("electron-builder --mac dmg");
  });

  it("rebuilds Windows native dependencies before creating the NSIS installer", () => {
    const script = readFileSync(resolve(root, "scripts/package-win-docker.sh"), "utf8");

    expect(script).toContain('ALLOW_UNSIGNED_PACKAGING');
    expect(script).toContain('WIN_CSC_LINK');
    expect(script).toContain('WIN_CSC_KEY_PASSWORD');
    expect(script).toContain("electron-builder install-app-deps --platform=win32 --arch=x64");
    expect(script).toContain("electron-builder --win nsis --x64");
  });
});
