import fs from "fs";
import os from "os";
import path from "path";

import {
  OCSF_ARCHITECTURE_CATEGORY_UID,
  OCSF_ARCHITECTURE_DISCOVERY_CLASS_UID,
  OCSF_ARCHITECTURE_DISCOVERY_TYPE_UID,
  PINNED_OCSF_BASE_VERSION,
  PINNED_OCSF_EXTENSION_NAME,
  PINNED_OCSF_EXTENSION_VERSION,
} from "../../ocsf-pins";
import { PINNED_ONTOLOGY_VERSION } from "../../pins";

interface LooseScanRecord {
  class_name: string;
  class_uid: number;
  category_name: string;
  category_uid: number;
  activity_id: number;
  activity_name: string;
  type_uid: number;
  time: number;
  metadata: { version: string; uid: string; extension: { name: string; version: string } };
  dataparade: {
    record_kind: string;
    ontology_version: string;
    source: string;
    asserted_at: string;
    asserts: string;
    asserted_slot?: string;
    asserted_value?: string;
  };
}

function writeScanRecord(
  dir: string,
  fileStem: string,
  asserts: string,
  slot?: string,
  value?: string,
): void {
  const record: LooseScanRecord = {
    class_name: "Architecture Discovery",
    class_uid: OCSF_ARCHITECTURE_DISCOVERY_CLASS_UID,
    category_name: "Architecture",
    category_uid: OCSF_ARCHITECTURE_CATEGORY_UID,
    activity_id: 1,
    activity_name: "Create",
    type_uid: OCSF_ARCHITECTURE_DISCOVERY_TYPE_UID,
    time: 1_577_836_800,
    metadata: {
      version: PINNED_OCSF_BASE_VERSION,
      uid: `dp:discovery/scan/test/${fileStem}`,
      extension: {
        name: PINNED_OCSF_EXTENSION_NAME,
        version: PINNED_OCSF_EXTENSION_VERSION,
      },
    },
    dataparade: {
      record_kind: "discovery",
      ontology_version: PINNED_ONTOLOGY_VERSION,
      source: "scan",
      asserted_at: "2020-01-01T00:00:00.000Z",
      asserts,
      ...(slot ? { asserted_slot: slot, asserted_value: value } : {}),
    },
  };
  fs.writeFileSync(path.join(dir, `${fileStem}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

/** Minimal OCSF dir: one scan-known flow with missing data_categories and purpose only. */
export function mkTinyOcsfGapDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ocsf-kb-gap-"));
  const flowUri = "dp:scan/entity/flow_1";
  const cmp1 = "dp:scan/entity/cmp_1";
  const cmp2 = "dp:scan/entity/cmp_2";
  const systemUri = "dp:a0/system";

  writeScanRecord(dir, "flow_1_entity", flowUri);
  writeScanRecord(dir, "flow_1_source", flowUri, "source_component", "cmp_1");
  writeScanRecord(dir, "flow_1_target", flowUri, "target_component", "cmp_2");
  writeScanRecord(dir, "cmp_1_entity", cmp1);
  writeScanRecord(dir, "cmp_2_entity", cmp2);
  writeScanRecord(dir, "system_in_scope", systemUri, "in_scope", "tiny-fixture");
  return dir;
}
