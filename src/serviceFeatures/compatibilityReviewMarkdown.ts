import type { CompatibilityPause, CompatibilityPauseReason } from "@/common/databaseCompatibility.ts";
import { $t } from "@/common/translation";

function withValue(message: string, values: Record<string, string>): string {
    return Object.entries(values).reduce((result, [key, value]) => result.replace(`\${${key}}`, value), message);
}

export function compatibilityReviewSummaryMarkdown(pause: CompatibilityPause): string {
    const action = !pause.resumable
        ? $t("This installation cannot safely acknowledge the detected state. Update Self-hosted LiveSync before attempting to synchronise again.")
        : $t("Before resuming, review the compatibility details and update Self-hosted LiveSync on every device which uses this remote database.");
    return `${$t("Remote synchronisation is paused on this device because its compatibility state requires attention.")}

${action}

${$t("Your automatic synchronisation preferences have not been changed. Closing this dialogue keeps synchronisation paused.")}`;
}

function reasonMarkdown(reason: CompatibilityPauseReason): string {
    if (reason.source === "database-version") {
        if (reason.state === "upgrade") {
            return `- ${withValue($t("The last acknowledged internal database version was **${ACKNOWLEDGED}** and this installation uses **${CURRENT}**."), { ACKNOWLEDGED: `**${reason.acknowledgedVersion}**`, CURRENT: `**${reason.currentVersion}**` })}`;
        }
        if (reason.state === "downgrade") {
            return `- ${withValue($t("This installation uses internal database version **${CURRENT}**, but this device previously acknowledged newer version **${ACKNOWLEDGED}**. An older installation must not resume synchronisation."), { CURRENT: `**${reason.currentVersion}**`, ACKNOWLEDGED: `**${reason.acknowledgedVersion}**` })}`;
        }
        if (reason.state === "missing") {
            return `- ${withValue($t("No previously acknowledged internal database version was found for this existing Vault. This can happen when a Vault is copied or restored, or when it is opened with a new Obsidian profile. This installation uses version **${CURRENT}**. An empty local database does not mean that it is safe to resume automatically."), { CURRENT: `**${reason.currentVersion}**` })}`;
        }
        return `- ${withValue($t("The saved internal database version marker is invalid. This installation uses version **${CURRENT}**."), { CURRENT: `**${reason.currentVersion}**` })}`;
    }
    if (reason.source === "settings-schema") {
        if (reason.isFromFutureSchema) {
            return `- ${withValue($t("The saved settings use schema **${SOURCE}**, which is newer than schema **${CURRENT}** supported by this installation."), { SOURCE: `**${reason.sourceVersion}**`, CURRENT: `**${reason.currentVersion}**` })}`;
        }
        return `- ${withValue($t("The settings were migrated from schema **${SOURCE}** to **${CURRENT}** and require review before synchronisation resumes."), { SOURCE: `**${reason.sourceVersion}**`, CURRENT: `**${reason.currentVersion}**` })}`;
    }
    const escapedMessage = reason.message.replace(/[\\`*_{}[\]()<>#+.!|-]/gu, "\\$&");
    return `- ${withValue($t("An earlier compatibility review remains pending: ${MESSAGE}"), { MESSAGE: escapedMessage })}`;
}

export function compatibilityReviewDetailsMarkdown(pause: CompatibilityPause): string {
    const resolution = !pause.resumable
        ? $t("Install a compatible current version of Self-hosted LiveSync. This pause cannot be dismissed by the current installation.")
        : $t("After all devices have been updated, return to the compatibility review summary and explicitly resume synchronisation. The current internal version will only then be recorded as acknowledged.");
    return `## ${$t("Why synchronisation is paused")}

${pause.reasons.map(reasonMarkdown).join("\n")}

## ${$t("What the pause changes")}

- ${$t("Remote replication is blocked before work begins.")}
- ${$t("Your saved automatic synchronisation preferences remain unchanged.")}
- ${$t("Closing either dialogue leaves the safety gate active.")}

## ${$t("What to do next")}

${resolution}`;
}
