import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  normalizeXmpPersonName,
  runXmpSidecarImport,
  scanXmpSidecars,
  xmpSidecarImportConfigDigest,
} from "../src/xmp-sidecar-import.mjs";

const providerPath = new URL(
  "../../providers/xmp-sidecar-reader/provider.py",
  import.meta.url,
).pathname;

test("private tier suffix normalization is deliberately limited to 1 and 2", () => {
  assert.deepEqual(normalizeXmpPersonName("  Benji   Hart 1 "), {
    normalization: "strip_trailing_private_tier_hint",
    normalizedName: "Benji Hart",
    rawName: "Benji Hart 1",
  });
  assert.equal(normalizeXmpPersonName("Person 2").normalizedName, "Person");
  assert.equal(normalizeXmpPersonName("Person 3").normalizedName, "Person 3");
  assert.equal(xmpSidecarImportConfigDigest.length, 64);
});

test("reader hashes paired bytes, emits no paths, and collapses MWG/Microsoft duplicates", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cimmich-xmp-reader-"));
  try {
    const media = path.join(root, "photo.jpg");
    await writeFile(media, "exact source bytes");
    await writeFile(
      `${media}.xmp`,
      `<?xml version="1.0"?>
      <x:xmpmeta xmlns:x="adobe:ns:meta/"
       xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
       xmlns:mwg-rs="http://www.metadataworkinggroup.com/schemas/regions/"
       xmlns:stArea="http://ns.adobe.com/xmp/sType/Area#"
       xmlns:MPReg="http://ns.microsoft.com/photo/1.2/t/Region#">
       <rdf:RDF><rdf:Description>
        <mwg-rs:RegionList><rdf:Bag><rdf:li><rdf:Description
          mwg-rs:Name="Known Person 1" mwg-rs:Type="Face">
          <mwg-rs:Area stArea:x="0.5" stArea:y="0.5"
            stArea:w="0.2" stArea:h="0.4" stArea:unit="normalized"/>
        </rdf:Description></rdf:li></rdf:Bag></mwg-rs:RegionList>
        <rdf:li MPReg:PersonDisplayName="Known Person 1"
          MPReg:Rectangle="0.4, 0.3, 0.2, 0.4"/>
       </rdf:Description></rdf:RDF>
      </x:xmpmeta>`,
    );
    await writeFile(path.join(root, "replacement.jpg"), "replacement bytes");
    const replacementPacket = `<?xml version="1.0"?>
      <x:xmpmeta xmlns:x="adobe:ns:meta/"
       xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
       xmlns:mwg-rs="http://www.metadataworkinggroup.com/schemas/regions/"
       xmlns:stArea="http://ns.adobe.com/xmp/sType/Area#">
       <rdf:RDF><rdf:Description>
        <mwg-rs:RegionList><rdf:Bag><rdf:li><rdf:Description
          mwg-rs:Name="Replacement Style" mwg-rs:Type="Face">
          <mwg-rs:Area stArea:x="0.5" stArea:y="0.5"
            stArea:w="0.2" stArea:h="0.4" stArea:unit="normalized"/>
       </rdf:Description></rdf:li></rdf:Bag></mwg-rs:RegionList>
       </rdf:Description></rdf:RDF>
      </x:xmpmeta>`;
    await writeFile(path.join(root, "replacement.xmp"), replacementPacket);
    await writeFile(path.join(root, "replacement.jpg.xmp"), replacementPacket);
    await writeFile(path.join(root, "ambiguous.jpg"), "jpeg bytes");
    await writeFile(path.join(root, "ambiguous.png"), "png bytes");
    await writeFile(
      path.join(root, "ambiguous.xmp"),
      `<?xml version="1.0"?>
      <x:xmpmeta xmlns:x="adobe:ns:meta/"
       xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
       xmlns:mwg-rs="http://www.metadataworkinggroup.com/schemas/regions/"
       xmlns:stArea="http://ns.adobe.com/xmp/sType/Area#">
       <rdf:RDF><rdf:Description>
        <mwg-rs:RegionList><rdf:Bag><rdf:li><rdf:Description
          mwg-rs:Name="Held Ambiguous Pair" mwg-rs:Type="Face">
          <mwg-rs:Area stArea:x="0.5" stArea:y="0.5"
            stArea:w="0.2" stArea:h="0.4" stArea:unit="normalized"/>
        </rdf:Description></rdf:li></rdf:Bag></mwg-rs:RegionList>
       </rdf:Description></rdf:RDF>
      </x:xmpmeta>`,
    );
    const values = [];
    for await (const entry of scanXmpSidecars({
      limitAssets: 5,
      providerPath,
      pythonPath: "/usr/bin/python3",
      root,
    })) {
      values.push(entry);
      if (entry.kind === "asset") {
        // Model the live importer doing database work after the reader has
        // already emitted its small bounded packet and exited.
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.equal(values.length, 4);
    assert.equal(values[0].kind, "asset");
    assert.equal(values[0].value.faces.length, 1);
    assert.equal(values[0].value.faces[0].rawName, "Known Person 1");
    assert.equal(values[0].value.byteLength, 18);
    assert.equal(values[0].value.contentDigest.length, 64);
    assert.equal(JSON.stringify(values).includes(root), false);
    assert.equal(JSON.stringify(values).includes("photo.jpg"), false);
    assert.equal(values[1].kind, "asset");
    assert.equal(values[1].value.faces[0].rawName, "Replacement Style");
    assert.equal(values[2].kind, "asset");
    assert.equal(
      values[1].value.contentDigest,
      values[2].value.contentDigest,
    );
    assert.notEqual(
      values[1].value.sourceLocatorDigest,
      values[2].value.sourceLocatorDigest,
    );
    assert.deepEqual(values[3].value, {
      emittedAssets: 3,
      kind: "summary",
      scannedSidecars: 4,
      skippedSidecars: 1,
    });
  } finally {
    await rm(root, { recursive: true });
  }
});

const fakeSql = ({ people = [{ person_id: "person_known" }] } = {}) => {
  const queries = [];
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    queries.push({ text, values });
    if (text.includes("FROM media_content_fingerprint")) {
      return [{ asset_id: "asset_hash_bound", content_id: "media_content_1" }];
    }
    if (text.includes("FROM xmp_sidecar_face_evidence")) return [];
    if (text.includes("FROM current_person person")) return people;
    if (text.includes("FROM face_observation face")) return [];
    return [];
  };
  sql.json = (value) => value;
  sql.queries = queries;
  return sql;
};

const packet = {
  byteLength: 100,
  contentDigest: "a".repeat(64),
  faces: [
    {
      box: { h: 0.4, w: 0.2, x: 0.4, y: 0.3 },
      rawName: "Known Person 1",
      regionKey: "b".repeat(64),
      source: "mwg-rs",
    },
  ],
  kind: "asset",
  sidecarDigest: "c".repeat(64),
  sourceLocatorDigest: "d".repeat(64),
};

const packets = async function* () {
  yield { kind: "asset", value: packet };
  yield {
    kind: "summary",
    value: {
      emittedAssets: 1,
      kind: "summary",
      scannedSidecars: 8,
      skippedSidecars: 1,
    },
  };
};

test("dry run binds by verified SHA-256 and predicts an existing-Person claim without writes", async () => {
  const sql = fakeSql();
  const result = await runXmpSidecarImport(sql, {
    execute: false,
    limitAssets: 1,
    packets: packets(),
    sourceId: "archive-xmp",
  });
  assert.equal(result.state, "dry_run_complete");
  assert.equal(result.boundAssets, 1);
  assert.equal(result.created_mapped, 1);
  assert.equal(result.faceCount, 1);
  assert.equal(result.sourceMediaWrite, "none");
  assert.equal(result.scannedSidecars, 8);
  assert.match(sql.queries[0].text, /verification = 'byte_verified'/);
  assert.equal(
    sql.queries.some(({ text }) => /\b(?:INSERT|UPDATE|DELETE)\b/.test(text)),
    false,
  );
});

test("ambiguous names remain non-authoritative triage evidence", async () => {
  const sql = fakeSql({
    people: [{ person_id: "person_a" }, { person_id: "person_b" }],
  });
  const result = await runXmpSidecarImport(sql, {
    execute: false,
    limitAssets: 1,
    packets: packets(),
    sourceId: "archive-xmp",
  });
  assert.equal(result.ambiguous_name, 1);
  assert.equal(result.created_mapped || 0, 0);
});
