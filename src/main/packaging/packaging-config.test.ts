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

  it("defines Linux release targets in electron-builder", () => {
    const builderConfig = readFileSync(resolve(root, "electron-builder.yml"), "utf8");

    expect(builderConfig).toMatch(/^\s*linux:\s*$/m);
    expect(builderConfig).toMatch(/^\s*-\s*AppImage\s*$/m);
    expect(builderConfig).toMatch(/^\s*-\s*deb\s*$/m);
  });

  it("packages Linux release artifacts from a native Linux host", () => {
    const script = readFileSync(resolve(root, "scripts/package-linux.sh"), "utf8");

    expect(script).toContain("Linux packaging must run on Linux.");
    expect(script).toContain("electron-builder install-app-deps --platform=linux --arch=");
    expect(script).toContain("electron-builder --linux AppImage deb");
  });

  it("supports native Windows packaging for release automation", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const script = readFileSync(resolve(root, "scripts/package-win-native.mjs"), "utf8");

    expect(packageJson.scripts["package:win:native"]).toBe("node scripts/package-win-native.mjs");
    expect(script).toContain('ALLOW_UNSIGNED_PACKAGING');
    expect(script).toContain("Native Windows packaging must run on Windows.");
    expect(script).toContain('process.env.ComSpec || "cmd.exe"');
    expect(script).toContain('"/d", "/s", "/c"');
    expect(script).toContain('result.error');
    expect(script).toContain('["exec", "electron-builder", "install-app-deps", "--platform=win32", "--arch=x64"]');
    expect(script).toContain('["exec", "electron-builder", "--win", "nsis", "--x64", "--config", "electron-builder.yml", "--publish", "never"]');
  });

  it("defines release metadata required for Linux deb packaging", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

    expect(packageJson.homepage).toBe("https://github.com/Svanny/capitalcombot");
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "https://github.com/Svanny/capitalcombot.git",
    });
    expect(packageJson.bugs).toEqual({
      url: "https://github.com/Svanny/capitalcombot/issues",
    });
    expect(packageJson.author).toEqual({
      name: "Svanny",
      email: "svanny@users.noreply.github.com",
    });
  });

  it("defines a tag-driven GitHub release workflow with checksums", () => {
    const workflow = readFileSync(resolve(root, ".github/workflows/release.yml"), "utf8");

    expect(workflow).toContain('name: release');
    expect(workflow).toContain('tags:');
    expect(workflow).toContain('"v*.*.*"');
    expect(workflow).toContain('macos-15-intel');
    expect(workflow).toContain('macos-15');
    expect(workflow).toContain('windows-latest');
    expect(workflow).toContain('ubuntu-latest');
    expect(workflow).toContain('sha256sum * > SHA256SUMS');
    expect(workflow).toContain('gh release upload');
  });

  it("clears partial macOS signing env before unsigned fallback packaging", () => {
    const workflow = readFileSync(resolve(root, ".github/workflows/release.yml"), "utf8");

    expect(workflow).toContain('unset CSC_LINK CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID');
    expect(workflow).toContain('export ALLOW_UNSIGNED_PACKAGING=1');
  });

  it("clears partial Windows signing env before unsigned fallback packaging", () => {
    const workflow = readFileSync(resolve(root, ".github/workflows/release.yml"), "utf8");

    expect(workflow).toContain('unset WIN_CSC_LINK WIN_CSC_KEY_PASSWORD CSC_LINK CSC_KEY_PASSWORD');
    expect(workflow).toContain('export ALLOW_UNSIGNED_PACKAGING=1');
  });
});
