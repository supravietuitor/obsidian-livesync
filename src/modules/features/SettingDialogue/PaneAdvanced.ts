import { ChunkAlgorithmNames } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { $msg, $t } from "@/common/translation";

export function paneAdvanced(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, { addPanel }: PageFunctions): void {
    void addPanel(paneEl, $msg("Memory cache")).then((paneEl) => {
        new Setting(paneEl).autoWireNumeric("hashCacheMaxCount", { clampMin: 10 });
        // new Setting(paneEl).autoWireNumeric("hashCacheMaxAmount", { clampMin: 1 });
    });
    void addPanel(paneEl, $msg("Local Database Tweak")).then((paneEl) => {
        paneEl.addClass("wizardHidden");

        const items = ChunkAlgorithmNames;
        new Setting(paneEl).autoWireDropDown("chunkSplitterVersion", {
            options: items,
        });
        new Setting(paneEl).autoWireNumeric("customChunkSize", { clampMin: 0, acceptZero: true });
    });

    void addPanel(paneEl, $msg("Transfer Tweak")).then((paneEl) => {
        new Setting(paneEl)
            .setClass("wizardHidden")
            .autoWireToggle("readChunksOnline", { onUpdate: this.onlyOnCouchDB });
        new Setting(paneEl)
            .setClass("wizardHidden")
            .autoWireToggle("useOnlyLocalChunk", { onUpdate: this.onlyOnCouchDB });

        new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("concurrencyOfReadChunksOnline", {
            clampMin: 10,
            onUpdate: this.onlyOnCouchDB,
        });

        new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("minimumIntervalOfReadChunksOnline", {
            clampMin: 10,
            onUpdate: this.onlyOnCouchDB,
        });
        new Setting(paneEl)
            .setClass("wizardHidden")
            .autoWireToggle("autoAcceptCompatibleTweak", { defaultToggleValue: true });
        // new Setting(paneEl)
        //     .setClass("wizardHidden")
        //     .autoWireToggle("sendChunksBulk", { onUpdate: onlyOnCouchDB })
        // new Setting(paneEl)
        //     .setClass("wizardHidden")
        //     .autoWireNumeric("sendChunksBulkMaxSize", {
        //         clampMax: 100, clampMin: 1, onUpdate: onlyOnCouchDB
        //     })
    });
    void addPanel(paneEl, $t("Remote Database Tweak")).then((paneEl) => {
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("enableCompression");
    });
}
