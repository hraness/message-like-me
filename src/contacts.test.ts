import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  normalizeContactHandle,
  readMacOSContacts,
} from "./contacts.ts";

const TEST_KEY = "synthetic-contacts-installation-key";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "message-like-me-contacts-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createDatabase(path: string, sparse = false): void {
  const database = new Database(path, { create: true, strict: true });
  try {
    database.exec(`
      CREATE TABLE Z_PRIMARYKEY(
        Z_ENT INTEGER PRIMARY KEY, Z_NAME TEXT NOT NULL, Z_SUPER INTEGER, Z_MAX INTEGER
      );
      INSERT INTO Z_PRIMARYKEY VALUES (7,'ABCDContact',NULL,100);
      INSERT INTO Z_PRIMARYKEY VALUES (9,'ABCDContactSubclass',7,100);
      INSERT INTO Z_PRIMARYKEY VALUES (22,'ABCDGroup',NULL,100);
      CREATE TABLE ZABCDRECORD(
        Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER NOT NULL, ZUNIQUEID TEXT,
        ZNAME TEXT, ZFIRSTNAME TEXT, ZMIDDLENAME TEXT, ZLASTNAME TEXT,
        ZORGANIZATION TEXT, ZJOBTITLE TEXT, ZTITLE TEXT, ZIMAGEDATA BLOB
      );
      CREATE TABLE ZABCDEMAILADDRESS(
        Z_PK INTEGER PRIMARY KEY, ZOWNER INTEGER NOT NULL, Z22_OWNER INTEGER NOT NULL,
        ZORDERINGINDEX INTEGER, ZADDRESS TEXT, ZLABEL TEXT, ZISPRIMARY INTEGER
      );
      CREATE TABLE ZABCDPHONENUMBER(
        Z_PK INTEGER PRIMARY KEY, ZOWNER INTEGER NOT NULL, Z22_OWNER INTEGER NOT NULL,
        ZORDERINGINDEX INTEGER, ZFULLNUMBER TEXT, ZLABEL TEXT, ZISPRIMARY INTEGER
      );
      CREATE TABLE ZABCDNOTE(
        Z_PK INTEGER PRIMARY KEY, ZCONTACT INTEGER NOT NULL, Z22_CONTACT INTEGER NOT NULL,
        ZTEXT TEXT, ZRICHTEXTDATA BLOB
      );
    `);
    if (sparse) {
      database.query(`INSERT INTO ZABCDRECORD(
        Z_PK,Z_ENT,ZUNIQUEID,ZNAME,ZFIRSTNAME,ZMIDDLENAME,ZLASTNAME,ZORGANIZATION,
        ZJOBTITLE,ZTITLE,ZIMAGEDATA
      ) VALUES (1,7,'root-only','ROOT DATABASE MUST BE IGNORED',NULL,NULL,NULL,NULL,NULL,NULL,NULL)`).run();
      return;
    }
    const insert = database.query(`INSERT INTO ZABCDRECORD(
      Z_PK,Z_ENT,ZUNIQUEID,ZNAME,ZFIRSTNAME,ZMIDDLENAME,ZLASTNAME,ZORGANIZATION,
      ZJOBTITLE,ZTITLE,ZIMAGEDATA
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    insert.run(1, 7, "contact-one", "", "Synthetic", "River", "Friend", null,
      "Builder", "Dr", new TextEncoder().encode("PRIVATE IMAGE SENTINEL"));
    insert.run(2, 9, "contact-two", "Second Contact", null, null, null, null,
      null, null, null);
    insert.run(3, 7, "contact-three", null, null, null, null, "Example Org",
      null, null, null);
    insert.run(4, 7, "contact-four", null, null, null, null, null,
      null, null, null);

    const email = database.query(`INSERT INTO ZABCDEMAILADDRESS(
      Z_PK,ZOWNER,Z22_OWNER,ZORDERINGINDEX,ZADDRESS,ZLABEL,ZISPRIMARY
    ) VALUES (?,?,22,?,?,?,?)`);
    email.run(1, 1, 0, "FRIEND@EXAMPLE.COM", "work", 1);
    email.run(2, 1, 1, "friend@example.com", "home", null);
    email.run(3, 2, 0, "second@example.com", "work", 1);
    email.run(4, 4, 0, "not-an-email", "other", null);

    const phone = database.query(`INSERT INTO ZABCDPHONENUMBER(
      Z_PK,ZOWNER,Z22_OWNER,ZORDERINGINDEX,ZFULLNUMBER,ZLABEL,ZISPRIMARY
    ) VALUES (?,?,22,?,?,?,?)`);
    phone.run(1, 1, 0, "00 1 (787) 555-0100", "mobile", 1);
    phone.run(2, 2, 0, "+1 787 555 0100", "mobile", null);
    phone.run(3, 3, 0, "(787) 555-0199", "mobile", 1);
    phone.run(4, 4, 0, "1-800-FLOWERS", "work", null);
    database.query(`INSERT INTO ZABCDNOTE(
      Z_PK,ZCONTACT,Z22_CONTACT,ZTEXT,ZRICHTEXTDATA
    ) VALUES (1,1,22,'PRIVATE NOTE SENTINEL',?)`).run(
      new TextEncoder().encode("PRIVATE NOTE BLOB SENTINEL"),
    );
  } finally {
    database.close();
  }
}

function createAddressBook(): Readonly<{ root: string; populated: string }> {
  const root = join(workspace(), "AddressBook");
  const source = join(root, "Sources", "TEST-STORE");
  mkdirSync(source, { recursive: true, mode: 0o700 });
  createDatabase(join(root, "AddressBook-v22.abcddb"), true);
  const populated = join(source, "AddressBook-v22.abcddb");
  createDatabase(populated);
  return { root, populated };
}

function fingerprint(path: string): unknown {
  const stats = statSync(path, { bigint: true });
  return {
    bytes: stats.size,
    modified: stats.mtimeNs,
    changed: stats.ctimeNs,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

describe("Contacts normalization", () => {
  test("keeps only conservative exact email and phone identities", () => {
    expect(normalizeContactHandle(" FRIEND@EXAMPLE.COM ")).toEqual({
      kind: "email",
      normalizedValue: "friend@example.com",
    });
    expect(normalizeContactHandle("00 1 (787) 555-0100")).toEqual({
      kind: "phone",
      normalizedValue: "+17875550100",
    });
    expect(normalizeContactHandle("+1 787 555 0100")).toEqual({
      kind: "phone",
      normalizedValue: "+17875550100",
    });
    expect(normalizeContactHandle("(787) 555-0100")).toEqual({
      kind: "phone",
      normalizedValue: "7875550100",
    });
    expect(normalizeContactHandle("+1 787 555 0100 ext 4")).toBeNull();
    expect(normalizeContactHandle("1-800-FLOWERS")).toBeNull();
    expect(normalizeContactHandle("person＠example.com")).toBeNull();
    expect(normalizeContactHandle("person@" + ".example.com")).toBeNull();
    expect(normalizeContactHandle("person@example." + ".com")).toBeNull();
    expect(normalizeContactHandle("123@4567")).toBeNull();
    expect(normalizeContactHandle("+1 787 555 0100 ☃")).toBeNull();
  });
});

describe("readMacOSContacts", () => {
  test("prefers populated Sources stores, follows entity descendants, and reads no unrelated fields", () => {
    const fixture = createAddressBook();
    const snapshot = readMacOSContacts(fixture.root, { hmacKey: TEST_KEY, pageSize: 2 });
    const repeated = readMacOSContacts(fixture.root, { hmacKey: TEST_KEY, pageSize: 3 });

    expect(repeated).toEqual(snapshot);
    expect(snapshot.sources).toHaveLength(1);
    expect(snapshot.contacts).toHaveLength(4);
    expect(snapshot.warnings).toEqual([
      "ignored invalid email handles: 1",
      "ignored invalid phone handles: 1",
      "contacts without exact matchable handles: 1",
    ]);
    const first = snapshot.contacts.find(({ privateLabel }) =>
      privateLabel === "Synthetic River Friend")!;
    expect(first.privateLabelBasis).toBe("name-parts");
    expect(first.handles.map(({ kind, normalizedValue }) => ({ kind, normalizedValue }))).toEqual([
      { kind: "email", normalizedValue: "friend@example.com" },
      { kind: "phone", normalizedValue: "+17875550100" },
    ]);
    expect(first.handles.every(({ matchId }) => /^[a-f0-9]{64}$/u.test(matchId))).toBeTrue();
    expect(snapshot.contacts.find(({ privateLabel }) => privateLabel === "Second Contact")
      ?.privateLabelBasis).toBe("display-name");
    expect(snapshot.contacts.find(({ privateLabel }) => privateLabel === "Example Org")
      ?.privateLabelBasis).toBe("organization");
    const encoded = JSON.stringify(snapshot);
    expect(encoded).not.toContain("ROOT DATABASE MUST BE IGNORED");
    expect(encoded).not.toContain("PRIVATE IMAGE SENTINEL");
    expect(encoded).not.toContain("PRIVATE NOTE SENTINEL");
    expect(encoded).not.toContain("PRIVATE NOTE BLOB SENTINEL");

    const otherInstall = readMacOSContacts(fixture.root, {
      hmacKey: "different-synthetic-contacts-key",
    });
    const labels = (contacts: typeof snapshot.contacts) => contacts
      .map(({ privateLabel }) => privateLabel)
      .sort((left, right) => (left ?? "").localeCompare(right ?? "", "en-US"));
    expect(labels(otherInstall.contacts)).toEqual(labels(snapshot.contacts));
    expect(otherInstall.contacts.map(({ id }) => id))
      .not.toEqual(snapshot.contacts.map(({ id }) => id));
  });

  test("reads committed WAL rows without modifying any source file", () => {
    const fixture = createAddressBook();
    const writer = new Database(fixture.populated, { strict: true });
    try {
      writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
      writer.query(`INSERT INTO ZABCDRECORD(
        Z_PK,Z_ENT,ZUNIQUEID,ZNAME,ZFIRSTNAME,ZLASTNAME
      ) VALUES (5,9,'wal-contact','WAL Contact','WAL','Contact')`).run();
      writer.query(`INSERT INTO ZABCDEMAILADDRESS(
        Z_PK,ZOWNER,Z22_OWNER,ZORDERINGINDEX,ZADDRESS
      ) VALUES (5,5,22,0,'wal@example.com')`).run();
      const paths = [fixture.populated, `${fixture.populated}-wal`, `${fixture.populated}-shm`];
      const before = paths.map(fingerprint);

      const snapshot = readMacOSContacts(fixture.root, { hmacKey: TEST_KEY });

      expect(snapshot.contacts.some(({ privateLabel }) => privateLabel === "WAL Contact")).toBeTrue();
      expect(paths.map(fingerprint)).toEqual(before);
    } finally {
      writer.close();
    }
  });

  test("does not create a missing source SHM", () => {
    const fixture = createAddressBook();
    const writer = new Database(fixture.populated, { strict: true });
    try {
      writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
      writer.query("UPDATE ZABCDRECORD SET ZJOBTITLE='Updated in WAL' WHERE Z_PK=1").run();
      rmSync(`${fixture.populated}-shm`);
      const beforeDatabase = fingerprint(fixture.populated);
      const beforeWal = fingerprint(`${fixture.populated}-wal`);

      readMacOSContacts(fixture.root, { hmacKey: TEST_KEY });

      expect(existsSync(`${fixture.populated}-shm`)).toBeFalse();
      expect(fingerprint(fixture.populated)).toEqual(beforeDatabase);
      expect(fingerprint(`${fixture.populated}-wal`)).toEqual(beforeWal);
    } finally {
      writer.close();
    }
  });

  test("rejects relative, symlinked, hard-linked, drifted, and orphaned sources", () => {
    expect(() => readMacOSContacts("relative/AddressBook", { hmacKey: TEST_KEY }))
      .toThrow("absolute");

    const fixture = createAddressBook();
    expect(() => readMacOSContacts(fixture.populated, {
      hmacKey: TEST_KEY,
      maxDatabaseBytes: 1,
    })).toThrow("size bound");
    const linked = join(workspace(), "AddressBook-v22.abcddb");
    symlinkSync(fixture.populated, linked);
    expect(() => readMacOSContacts(linked, { hmacKey: TEST_KEY })).toThrow("non-symlink");

    const hardLinked = join(workspace(), "AddressBook-v23.abcddb");
    linkSync(fixture.populated, hardLinked);
    expect(() => readMacOSContacts(hardLinked, { hmacKey: TEST_KEY })).toThrow("non-symlink");
    rmSync(hardLinked);

    const database = new Database(fixture.populated, { strict: true });
    database.exec("ALTER TABLE ZABCDEMAILADDRESS RENAME COLUMN ZOWNER TO Z22_CONTACT");
    database.close();
    expect(() => readMacOSContacts(fixture.root, { hmacKey: TEST_KEY }))
      .toThrow("missing required column ZOWNER");

    const orphan = createAddressBook();
    const orphanDatabase = new Database(orphan.populated, { strict: true });
    orphanDatabase.query(`INSERT INTO ZABCDPHONENUMBER(
      Z_PK,ZOWNER,Z22_OWNER,ZORDERINGINDEX,ZFULLNUMBER
    ) VALUES (99,999,22,0,'+17875550111')`).run();
    orphanDatabase.close();
    expect(() => readMacOSContacts(orphan.root, { hmacKey: TEST_KEY }))
      .toThrow("missing contact");
  });
});
