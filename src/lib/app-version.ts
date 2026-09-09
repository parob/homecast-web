/**
 * The native app's version, as one line.
 *
 * Three places print it — the ⋮ menu footer, Settings → Account → Version and
 * the staging banner — and until this existed each assembled its own, which is
 * how the build number went missing from all three at once. The Swift shell
 * injects three globals:
 *
 *   homecastAppVersion      CFBundleShortVersionString   1.0.5
 *   homecastAppBuildNumber  CFBundleVersion              57
 *   homecastAppBuild        git short hash               53a6520
 *
 * The build number is the one that matters when something is wrong: it is what
 * App Store Connect and TestFlight number a build by, and what "which build
 * are you on?" is actually asking. The hash says which commit that build was
 * cut from. Both are optional — the number arrived later than the other two,
 * so an installed app may inject only the hash, and a hash of "unknown" is the
 * generator's own placeholder for a checkout with no git, not a hash.
 */

export interface AppVersionSource {
  homecastAppVersion?: string;
  homecastAppBuildNumber?: string;
  homecastAppBuild?: string;
}

/** `1.0.5 (57 · 53a6520)`, or as much of it as this app can say. Null off-app. */
export function appVersionLabel(win: AppVersionSource): string | null {
  const version = win.homecastAppVersion;
  if (!version) return null;
  const details = [
    win.homecastAppBuildNumber && win.homecastAppBuildNumber !== 'unknown'
      ? win.homecastAppBuildNumber
      : null,
    win.homecastAppBuild && win.homecastAppBuild !== 'unknown' ? win.homecastAppBuild : null,
  ].filter((d): d is string => !!d);
  return details.length ? `${version} (${details.join(' · ')})` : version;
}
