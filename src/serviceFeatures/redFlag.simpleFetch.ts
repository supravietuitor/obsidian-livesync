import { LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { type LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { UnresolvedErrorManager } from "@vrtmrz/livesync-commonlib/compat/services/base/UnresolvedErrorManager";
import {
    ExtraOnLocal,
    ExtraOnRemote,
    FullScanModes,
    normaliseFullScanOptions,
    synchroniseAllFilesBetweenDBandStorage,
    type FullScanOptions,
} from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner";
import { adjustSettingToRemoteIfNeeded, cancelScheduledInitialisation, processVaultInitialisation } from "./redFlag";
import { $t } from "@/common/translation";

export const SIMPLE_FETCH_STAGE1_REMOTE_WINS = "Overwrite all with remote files";
export const SIMPLE_FETCH_STAGE1_NEWER_WINS = "Compare time and take newer";
export const SIMPLE_FETCH_STAGE1_DETAILED = "Use the detailed flow";
export const SIMPLE_FETCH_STAGE1_CANCEL = "Cancel";

export const SIMPLE_FETCH_STAGE2_REMOTE_DELETE_NONE = "Keep local files even if not on remote";
export const SIMPLE_FETCH_STAGE2_REMOTE_DELETE_ALL = "Delete local files if not on remote";

export const SIMPLE_FETCH_STAGE2_NEWER_CLEANUP = "Delete local files if deleted on remote";
export const SIMPLE_FETCH_STAGE2_NEWER_SYNC_ALL = "Keep local files even if deleted on remote";
export const STAGE2_ABORT = "Cancel all and reboot";

const SIMPLE_FETCH_MODE_KEY = "simple-fetch-mode";

function buildSimpleFetchResult(stage1: string, stage2?: string) {
    if (stage1 === SIMPLE_FETCH_STAGE1_DETAILED) {
        return { mode: "detailed", options: {} };
    }
    if (stage1 === SIMPLE_FETCH_STAGE1_REMOTE_WINS && stage2) {
        if (![SIMPLE_FETCH_STAGE2_REMOTE_DELETE_ALL, SIMPLE_FETCH_STAGE2_REMOTE_DELETE_NONE].includes(stage2)) {
            return undefined;
        }
        return {
            mode: "remote-only",
            options: {
                mode: FullScanModes.DB_APPLY,
                extraOnRemote:
                    stage2 === SIMPLE_FETCH_STAGE2_REMOTE_DELETE_ALL ? ExtraOnRemote.DELETE_LOCAL_MISSING : undefined,
            },
        };
    }
    if (stage1 === SIMPLE_FETCH_STAGE1_NEWER_WINS && stage2) {
        if (![SIMPLE_FETCH_STAGE2_NEWER_CLEANUP, SIMPLE_FETCH_STAGE2_NEWER_SYNC_ALL].includes(stage2)) {
            return undefined;
        }
        return {
            mode: "newer-wins",
            options: {
                mode: FullScanModes.NEWER_WINS,
                extraOnLocal:
                    stage2 === SIMPLE_FETCH_STAGE2_NEWER_CLEANUP
                        ? ExtraOnLocal.DELETE_DB_DELETED
                        : ExtraOnLocal.APPEND_STORAGE_ONLY,
            },
        };
    }
    return undefined;
}

function rememberSimpleFetchMode(host: NecessaryServices<"setting", never>, stage1: string, stage2?: string) {
    host.services.setting.setSmallConfig(SIMPLE_FETCH_MODE_KEY, JSON.stringify({ stage1, stage2 }));
}

function getRememberedSimpleFetchMode(host: NecessaryServices<"setting", never>) {
    const saved = host.services.setting.getSmallConfig(SIMPLE_FETCH_MODE_KEY);
    if (!saved) return undefined;
    try {
        const { stage1, stage2 } = JSON.parse(saved) as { stage1?: string; stage2?: string };
        if (stage1) {
            const remembered = buildSimpleFetchResult(stage1, stage2);
            if (remembered) return remembered;
        }
    } catch {
        // Clear below; the saved choice is optional and can be rebuilt by asking again.
    }
    host.services.setting.deleteSmallConfig(SIMPLE_FETCH_MODE_KEY);
    return undefined;
}

function clearRememberedSimpleFetchMode(host: NecessaryServices<"setting", never>) {
    host.services.setting.deleteSmallConfig(SIMPLE_FETCH_MODE_KEY);
}

export async function askSimpleFetchMode(
    host: NecessaryServices<"UI" | "setting", never>
): Promise<{ mode: string; options: Partial<FullScanOptions> } | "cancelled" | "aborted"> {
    const remembered = getRememberedSimpleFetchMode(host);
    if (remembered) return remembered;

    const choices = (...values: string[]) => values.map((value) => $t(value));
    const choiceId = (selected: string, values: string[]) => values.find((value) => $t(value) === selected);

    const msg = `${$t("We are about to retrieve the remote data.")}

${$t("Firstly, how shall we handle the data retrieved from this remote source?")}

- **${$t(SIMPLE_FETCH_STAGE1_NEWER_WINS)}**: ${$t("Compares the modified time of files and takes the newer one.")}
  ${$t("If you have been using Self-hosted LiveSync and have made changes on multiple devices, this option may be suitable for you as it tries to merge changes based on modified time.")}
- **${$t(SIMPLE_FETCH_STAGE1_REMOTE_WINS)}**: ${$t("Remote data is the source of truth.")}
  ${$t("If you are new to using Self-hosted LiveSync, this option may be easiest to understand and get started with.")}
  ${$t("It will overwrite all your local files with the remote data, so please make sure you have a backup if there is any important data in your vault.")}
- **${$t(SIMPLE_FETCH_STAGE1_DETAILED)}**: ${$t("Opens the detailed setup wizard.")}
  ${$t("If you want to have more control over the synchronisation process, or want to review the changes before applying, you can choose this option to use the detailed flow.")}
    `;
    const stage1 = await host.services.UI.confirm.confirmWithMessage(
        $t("Data retrieval scheduled"),
        msg,
        choices(
            SIMPLE_FETCH_STAGE1_NEWER_WINS,
            SIMPLE_FETCH_STAGE1_REMOTE_WINS,
            SIMPLE_FETCH_STAGE1_DETAILED,
            SIMPLE_FETCH_STAGE1_CANCEL,
        ),
        $t(SIMPLE_FETCH_STAGE1_NEWER_WINS),
        0
    );

    const stage1Id = stage1 && choiceId(stage1, [
        SIMPLE_FETCH_STAGE1_NEWER_WINS,
        SIMPLE_FETCH_STAGE1_REMOTE_WINS,
        SIMPLE_FETCH_STAGE1_DETAILED,
        SIMPLE_FETCH_STAGE1_CANCEL,
    ]);
    if (!stage1Id || stage1Id === SIMPLE_FETCH_STAGE1_CANCEL) return "cancelled";

    if (stage1Id === SIMPLE_FETCH_STAGE1_DETAILED) {
        return buildSimpleFetchResult(stage1Id)!;
    }

    if (stage1Id === SIMPLE_FETCH_STAGE1_REMOTE_WINS) {
        const msg = `${$t("Since you have chosen to overwrite all local files with remote data, **how would you like to handle local files that are not present in the remote database?**")}

- **${$t(SIMPLE_FETCH_STAGE2_REMOTE_DELETE_ALL)}**: ${$t("Local-only files and remote-deleted files will be removed.")}
  ${$t("This option will make your local vault exactly the same as the remote database, but please make sure you have a backup if there is any important data in your vault.")}
- **${$t(SIMPLE_FETCH_STAGE2_REMOTE_DELETE_NONE)}**: ${$t("All existing local files will be preserved.")}
  ${$t("This option will keep all your local files, but it may cause duplicates if there are files that exist on local but not on remote. You can clean up these duplicates manually after the synchronisation.")}`;

        const stage2 = await host.services.UI.confirm.confirmWithMessage(
            $t("How to handle extra existing local files?"),
            msg,
            choices(SIMPLE_FETCH_STAGE2_REMOTE_DELETE_ALL, SIMPLE_FETCH_STAGE2_REMOTE_DELETE_NONE, STAGE2_ABORT),
            $t(SIMPLE_FETCH_STAGE2_REMOTE_DELETE_NONE),
            0
        );
        const stage2Id = stage2 &&
            choiceId(stage2, [SIMPLE_FETCH_STAGE2_REMOTE_DELETE_ALL, SIMPLE_FETCH_STAGE2_REMOTE_DELETE_NONE, STAGE2_ABORT]);
        if (!stage2Id) return "cancelled";
        if (stage2Id === STAGE2_ABORT) {
            return "aborted";
        }
        rememberSimpleFetchMode(host, stage1Id, stage2Id);
        return buildSimpleFetchResult(stage1Id, stage2Id)!;
    }

    if (stage1Id === SIMPLE_FETCH_STAGE1_NEWER_WINS) {
        const msg = `${$t("How should files that were deleted on other devices be handled?")}

- **${$t(SIMPLE_FETCH_STAGE2_NEWER_CLEANUP)}**: ${$t("Delete local files if they were deleted on remote.")}
  ${$t("This is useful if you want to keep your vault clean and consistent across devices, but please make sure you have a backup if there is already any important data in your vault.")}
- **${$t(SIMPLE_FETCH_STAGE2_NEWER_SYNC_ALL)}**: ${$t("Recreate remote files even if they were deleted on remote.")}
  ${$t("This option will keep all your local files, but it may cause duplicates if there are files that exist on local but not on remote. You can clean up these duplicates manually after the synchronisation.")}
  `;

        const stage2 = await host.services.UI.confirm.confirmWithMessage(
            $t("Conflict & Deletion Options"),
            msg,
            choices(SIMPLE_FETCH_STAGE2_NEWER_CLEANUP, SIMPLE_FETCH_STAGE2_NEWER_SYNC_ALL, STAGE2_ABORT),
            $t(SIMPLE_FETCH_STAGE2_NEWER_SYNC_ALL),
            0
        );
        const stage2Id = stage2 &&
            choiceId(stage2, [SIMPLE_FETCH_STAGE2_NEWER_CLEANUP, SIMPLE_FETCH_STAGE2_NEWER_SYNC_ALL, STAGE2_ABORT]);
        if (!stage2Id) return "cancelled";
        if (stage2Id === STAGE2_ABORT) {
            return "aborted";
        }
        rememberSimpleFetchMode(host, stage1Id, stage2Id);
        return buildSimpleFetchResult(stage1Id, stage2Id)!;
    }

    return "cancelled";
}

const RERUN_PROCESS = "Reboot to re-run the process";
const RELEASE_FLAG_PROCESS = "Finalise the process and resume normal operation";
export async function askAndPerformFastSetupOnScheduledFetchAll(
    host: NecessaryServices<
        | "vault"
        | "fileProcessing"
        | "tweakValue"
        | "UI"
        | "setting"
        | "appLifecycle"
        | "path"
        | "keyValueDB"
        | "database",
        "storageAccess" | "rebuilder" | "fileHandler"
    >,
    log: LogFunction,
    cleanupFlag: () => Promise<void>
): Promise<boolean | undefined> {
    const result = await askSimpleFetchMode(host);
    if (result === "cancelled") {
        log("Fetch cancelled by user.", LOG_LEVEL_NOTICE);
        clearRememberedSimpleFetchMode(host);
        return await cancelScheduledInitialisation(host, cleanupFlag);
    }
    if (result === "aborted") {
        log("Fetch exited by user.", LOG_LEVEL_NOTICE);
        clearRememberedSimpleFetchMode(host);
        host.services.appLifecycle.performRestart();
        return false;
    }
    if (result.mode === "detailed") {
        return undefined; // Let the detailed setup flow handle it.
    }

    const settings = host.services.setting.currentSettings();
    if (!(await adjustSettingToRemoteIfNeeded(host, log, { preventFetchingConfig: false }, settings))) {
        log("Fetch initialisation cancelled by user.", LOG_LEVEL_NOTICE);
        clearRememberedSimpleFetchMode(host);
        return await cancelScheduledInitialisation(host, cleanupFlag);
    }

    const performFastSetup = async () => {
        // 1. Perform fast DB fetch (download remote DB content to local DB)
        await host.serviceModules.rebuilder.$fetchLocalDBFast(false);

        // 2. Call the extended synchroniseAllFilesBetweenDBandStorage to reflect changes in storage
        const errorManager = new UnresolvedErrorManager(host.services.appLifecycle, host.services.context.events);
        const syncResult = await synchroniseAllFilesBetweenDBandStorage(
            host,
            log,
            errorManager,
            normaliseFullScanOptions({
                ...result.options,
                showingNotice: true,
                omitEvents: true,
                ignoreSuspending: true,
            })
        );
        if (!syncResult) {
            const canRelease = await host.services.UI.confirm.askSelectStringDialogue(
                "Some files failed to synchronise. What would you like to do?",
                [RERUN_PROCESS, RELEASE_FLAG_PROCESS],
                { defaultAction: RELEASE_FLAG_PROCESS, title: $t("Synchronisation Issues Detected") }
            );
            if (canRelease === RERUN_PROCESS) {
                log("User chose to reboot and re-run the process.", LOG_LEVEL_NOTICE);
                // Prevent to delete the flag, so that the process will be re-run after reboot.
                // await cleanupFlag();
                host.services.appLifecycle.performRestart();
                return false;
            }
        }
        await host.serviceModules.rebuilder.finishRebuild();
        await cleanupFlag();
        clearRememberedSimpleFetchMode(host);
        log("Simple fetch and scan operation completed.", LOG_LEVEL_NOTICE);
        return true;
    };
    return await processVaultInitialisation(host, log, performFastSetup, "keep-on-failure");
}
