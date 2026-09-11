#!/usr/bin/env node

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  createProviderBaseline, decodeProviderReceipt, encodeProviderReceipt,
  siteProviderPrimitives as provider, waitForAdmittedProviderOutcome,
} from "./release-provider-outcome.mjs";
import {
  decodeProductionAuthorityPhaseReceipt, finalizeProductionAuthority,
  parseCurrentProductionAuthoritySuccess, parseProductionAuthorityRulesApiClosure,
  productionAuthorityReceiptDigest,
} from "./release-production-authority.mjs";
import {
  assertSiteWorkflowAdmissionReceipt, decodeWorkflowAdmissionReceipt, encodeWorkflowAdmissionReceipt,
  verifySiteWorkflowAdmission, writeControlEpochReview, ControlEpochAdmissionError,
} from "./release-workflow-range.mjs";
import { advanceWebsiteProductionSiteRef, proveWebsiteProductionSiteRequiredStatusDenial } from "./release-ref-writer.mjs";
import {
  SITE_ARTIFACT_NAME, SITE_REPOSITORY, SITE_REPOSITORY_ID,
  parseSiteBuildManifest, parseSiteSubject, revalidateSiteSource, revalidateSiteSubject,
  siteDigest, siteId, siteRecord, siteSha, siteTimestamp,
} from "./site-production-subject.mjs";

const REF = "refs/heads/website-production";
const DENIAL_SCHEMA = "textbutler-site-required-status-denial-v1";
const PROMOTION_SCHEMA = "textbutler-site-provider-promotion-v1";
const MAX_JSON = 64 * 1024;

function fail(message) { throw new Error(message); }
function hashBytes(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function date(value) { return Date.parse(siteTimestamp(value, "site evidence time")); }

export function assertSiteInvocation(environment) {
  const sourceSha = siteSha(environment.SITE_SOURCE_SHA);
  if (environment.GITHUB_ACTIONS !== "true" || environment.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      environment.GITHUB_REF !== "refs/heads/main" || environment.GITHUB_SHA !== sourceSha ||
      environment.GITHUB_REPOSITORY !== SITE_REPOSITORY || environment.GITHUB_REPOSITORY_ID !== String(SITE_REPOSITORY_ID) ||
      environment.GITHUB_RUN_ATTEMPT !== "1" || (environment.SITE_RELEASE_TAG ?? "") !== "") fail("site promotion requires one attempt-1 dispatch from exact current main without a package tag");
  return Object.freeze({ sourceSha, ciRunId: siteId(environment.SITE_CI_RUN_ID, "CI run"),
    ciRunAttempt: siteId(environment.SITE_CI_RUN_ATTEMPT, "CI attempt"),
    buildRunId: siteId(environment.GITHUB_RUN_ID, "site workflow run"), buildRunAttempt: 1 });
}

function assertNoAppKey(environment, writer = false) {
  for (const key of Object.keys(environment)) {
    if (key.startsWith("MLM_RELEASE_APP_") && environment[key] !== undefined) fail("site admission/writer cannot receive App credentials");
  }
  if (!writer && environment.MLM_RELEASE_REF_TOKEN) fail("read-only site admission cannot receive the ref token");
}

function normalizeBaseline(value, subject, allowExact = false) {
  const baseline = provider.parseBaselineReceipt(value);
  if (baseline.repository !== SITE_REPOSITORY || baseline.verifiedSha !== subject.sourceSha || (!allowExact && baseline.refSha === subject.sourceSha)) {
    fail("site baseline must bind an advancing current-main target");
  }
  return { baseline, baselineValue: provider.baselineReceiptValue(baseline) };
}

function parseSiteDenial(value, subject, baseline) {
  const receipt = siteRecord(value, ["baselineDigest", "denial", "observedAt", "preconditionSha256", "previousSha",
    "productionRef", "repository", "rules", "schema", "verifiedSha", "subject"], "site denial");
  siteRecord(receipt.denial, ["classification", "diagnosticSha256"], "site denial evidence");
  if (receipt.schema !== DENIAL_SCHEMA || receipt.repository !== SITE_REPOSITORY || receipt.productionRef !== REF ||
      receipt.verifiedSha !== subject.sourceSha || receipt.previousSha !== baseline.refSha ||
      receipt.baselineDigest !== siteDigest(provider.baselineReceiptValue(baseline)) ||
      !same(parseSiteSubject(receipt.subject), subject) || receipt.denial.classification !== "required-status-errored" ||
      !/^[0-9a-f]{64}$/u.test(receipt.denial.diagnosticSha256) || !/^[0-9a-f]{64}$/u.test(receipt.preconditionSha256)) {
    fail("site denial does not bind its subject, baseline, and denied writer");
  }
  siteTimestamp(receipt.observedAt, "site denial time");
  return receipt;
}

export async function proveSiteProductionDenial({ api, subject: value, baselineReceipt, preconditionReceipt, workflowReceipt, denyRef }) {
  const subject = await revalidateSiteSubject(api, value);
  const { baseline, baselineValue } = normalizeBaseline(baselineReceipt, subject);
  const precondition = decodeProductionAuthorityPhaseReceipt(preconditionReceipt);
  if (precondition.phase !== "consumed" || precondition.targetSha !== subject.sourceSha ||
      precondition.attestationSha256 !== null || precondition.promotionSha256 !== null) fail("site denial needs exact terminal precondition");
  assertSiteWorkflowAdmissionReceipt(workflowReceipt, { previousSha: baseline.refSha, targetSha: subject.sourceSha });
  const before = await provider.readProductionRefWithServerDate(api, SITE_REPOSITORY);
  if (before.sha !== baseline.refSha) fail("production ref moved before site denial");
  const rules = parseProductionAuthorityRulesApiClosure(await api.getRules(), "site denial");
  if (date(before.timestamp) < date(precondition.revocation.lastObservationServerDate) ||
      Object.values(rules.serverDates).some(value => date(value) < date(before.timestamp))) fail("site denial rules predate terminal precondition");
  const denial = await denyRef({ expectedOldSha: baseline.refSha, targetSha: subject.sourceSha });
  const after = await provider.readProductionRefWithServerDate(api, SITE_REPOSITORY);
  if (after.sha !== baseline.refSha || Object.values(rules.serverDates).some(value => date(after.timestamp) < date(value))) {
    fail("site denial did not preserve exact production ref");
  }
  await revalidateSiteSubject(api, subject);
  return parseSiteDenial({ baselineDigest: siteDigest(baselineValue), denial, observedAt: after.timestamp,
    preconditionSha256: productionAuthorityReceiptDigest(precondition), previousSha: baseline.refSha,
    productionRef: REF, repository: SITE_REPOSITORY, rules, schema: DENIAL_SCHEMA,
    verifiedSha: subject.sourceSha, subject }, subject, baseline);
}

export async function promoteSiteProduction({ api, subject: value, baselineReceipt, denialReceipt, attestationReceipt, workflowReceipt, advanceRef }) {
  const subject = await revalidateSiteSubject(api, value);
  const { baseline, baselineValue } = normalizeBaseline(baselineReceipt, subject);
  const denial = parseSiteDenial(denialReceipt, subject, baseline);
  assertSiteWorkflowAdmissionReceipt(workflowReceipt, { previousSha: baseline.refSha, targetSha: subject.sourceSha });
  const before = await provider.readProductionRefWithServerDate(api, SITE_REPOSITORY);
  if (before.sha !== baseline.refSha || date(before.timestamp) < baseline.completedMilliseconds ||
      date(before.timestamp) <= date(subject.buildCompletedAt)) fail("site promotion boundary changed or predates admission");
  await provider.readFastForwardComparison(api, SITE_REPOSITORY, baseline.refSha, subject.sourceSha);
  const attested = decodeProductionAuthorityPhaseReceipt(attestationReceipt);
  if (attested.phase !== "attested" || attested.targetSha !== subject.sourceSha) fail("site promotion requires exact App status");
  const rules = parseProductionAuthorityRulesApiClosure(await api.getRules(), "site pre-push");
  if (!same(rules.rules, denial.rules.rules) || !same(rules.bodySha256, denial.rules.bodySha256) ||
      Object.values(rules.serverDates).some(value => date(value) < date(denial.observedAt) ||
        date(value) < date(attested.revocation.lastObservationServerDate))) fail("site authority rules changed or predate revocation");
  const statusResponse = await api.getWithServerDate(`/repos/${SITE_REPOSITORY}/commits/${subject.sourceSha}/status?per_page=100`);
  const status = parseCurrentProductionAuthoritySuccess(statusResponse.body, statusResponse.serverDate, attested);
  if (date(attested.status.serverDate) < date(denial.observedAt) ||
      Object.values(rules.serverDates).some(value => date(status.serverDate) < date(value))) fail("site status predates denial or rules");
  // This read is deliberately immediately before the bounded writer, after all awaits.
  await revalidateSiteSubject(api, subject);
  const pushed = siteRecord(await advanceRef({ expectedOldSha: baseline.refSha, targetSha: subject.sourceSha }),
    ["classification", "fromSha", "toSha", "protectedRef", "summarySha256"], "site writer receipt");
  if (pushed.classification !== "fast-forward" || pushed.fromSha !== baseline.refSha ||
      pushed.toSha !== subject.sourceSha || pushed.protectedRef !== REF ||
      !/^[0-9a-f]{64}$/u.test(pushed.summarySha256)) fail("site writer has no exact attributable fast-forward receipt");
  const writerPush = Object.freeze({ classification: "fast-forward", fromSha: pushed.fromSha,
    protectedRef: REF, summarySha256: pushed.summarySha256, toSha: pushed.toSha });
  const after = await provider.readProductionRefWithServerDate(api, SITE_REPOSITORY);
  if (after.sha !== subject.sourceSha) fail("site production ref does not match after promotion; reconcile before retrying");
  await revalidateSiteSubject(api, subject);
  const receipt = Object.freeze({
    authority: Object.freeze({ attestationSha256: productionAuthorityReceiptDigest(attested), statusId: status.statusId,
      statusNodeId: status.statusNodeId, statusReadbackAt: status.serverDate }),
    baselineDigest: siteDigest(baselineValue), boundaryAt: before.timestamp, denialSha256: siteDigest(denial),
    mode: "advanced", previousSha: baseline.refSha, promotedAt: after.timestamp, productionRef: REF,
    subject, repository: SITE_REPOSITORY, rules, schema: PROMOTION_SCHEMA, verifiedSha: subject.sourceSha, writerPush,
  });
  return Object.freeze({ ...receipt, receiptSha256: siteDigest(receipt) });
}

export async function waitForSiteProduction({ api, subject: value, baselineReceipt, promotionReceipt, finalizeInput, ...options }) {
  const subject = await revalidateSiteSubject(api, value);
  const { baseline } = normalizeBaseline(baselineReceipt, subject);
  const final = await finalizeProductionAuthority({ api, ...finalizeInput, promotion: promotionReceipt });
  const promotion = final.promotion;
  if (promotion.schema !== PROMOTION_SCHEMA || !same(promotion.subject, subject) ||
      promotion.baselineDigest !== siteDigest(provider.baselineReceiptValue(baseline))) fail("site final authority has the wrong subject or baseline");
  const normalized = Object.freeze({ ...promotion, boundaryMilliseconds: date(promotion.boundaryAt),
    promotedMilliseconds: date(promotion.promotedAt) });
  return waitForAdmittedProviderOutcome({ ...options, api, baseline, promotion: normalized, workflowSource: undefined,
    revalidateSubject: async () => { await revalidateSiteSubject(api, subject); } });
}

export async function assertConsumedSiteStatus(api, subject) {
  const endpoint = `/repos/${SITE_REPOSITORY}/commits/${subject.sourceSha}`;
  const combined = await api.get(`${endpoint}/status?per_page=100`);
  const context = "message-like-me/website-production-authority";
  const current = combined.statuses?.filter(status => status.context === context);
  if (combined.sha !== subject.sourceSha || combined.repository?.id !== SITE_REPOSITORY_ID ||
      combined.repository.full_name !== SITE_REPOSITORY || !Array.isArray(combined.statuses) ||
      combined.total_count !== combined.statuses.length || combined.total_count > 100 ||
      current?.length !== 1 || current[0].state !== "error" ||
      current[0].description !== "Release authority consumed after the production-ref attempt") {
    fail("already-exact site requires terminal authority; use the existing custody cleanup first");
  }
  const statuses = await api.get(`${endpoint}/statuses?per_page=100`);
  const actor = await api.get("/users/mlm-prod-ref-writer-1342143606%5Bbot%5D");
  const matching = Array.isArray(statuses) ? statuses.filter(status => status.context === context) : [];
  const latest = matching[0];
  if (!latest || latest.id !== current[0].id || latest.node_id !== current[0].node_id || latest.state !== "error" ||
      latest.creator?.login !== "mlm-prod-ref-writer-1342143606[bot]" || latest.creator.type !== "Bot") {
    fail("already-exact site authority was not consumed by the exact status App");
  }
  if (actor.login !== latest.creator.login || actor.type !== "Bot" || !Number.isSafeInteger(actor.id) || actor.id < 1 ||
      actor.id !== latest.creator.id || typeof actor.node_id !== "string" || actor.node_id !== latest.creator.node_id) {
    fail("already-exact site status does not bind the App bot numeric actor");
  }
}

export async function qualifyExistingSiteProduction({ api, subject: value, baselineReceipt, ...options }) {
  const subject = await revalidateSiteSubject(api, value);
  const { baseline } = normalizeBaseline(baselineReceipt, subject, true);
  if (baseline.refSha !== subject.sourceSha) fail("read-only site recovery requires the already-exact production ref");
  await assertConsumedSiteStatus(api, subject);
  parseProductionAuthorityRulesApiClosure(await api.getRules(), "already-exact site authority");
  const promotion = Object.freeze({ subject, repository: SITE_REPOSITORY, verifiedSha: subject.sourceSha,
    previousSha: subject.sourceSha, mode: "already-exact", boundaryMilliseconds: baseline.completedMilliseconds,
    promotedMilliseconds: baseline.completedMilliseconds });
  return waitForAdmittedProviderOutcome({ ...options, api, baseline, promotion, workflowSource: undefined,
    revalidateSubject: async () => {
      await revalidateSiteSubject(api, subject);
      await assertConsumedSiteStatus(api, subject);
      parseProductionAuthorityRulesApiClosure(await api.getRules(), "already-exact site authority");
    } });
}

function output(name, value) {
  if (!/^[a-z][a-z0-9_]*$/u.test(name) || typeof value !== "string" || /[\r\n]/u.test(value)) fail("invalid site output");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, "utf8");
  else process.stdout.write(`${name}=${value}\n`);
}

function emitReceipt(receipt) {
  output("receipt", encodeProviderReceipt(receipt));
  output("receipt_sha256", siteDigest(receipt));
}

function gitText(args) {
  const result = spawnSync("/usr/bin/git", ["-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", ...args], {
    encoding: "utf8", env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C" },
    timeout: 120000, maxBuffer: 256 * 1024,
  });
  if (result.error || result.status !== 0) fail("site source Git check failed");
  return result.stdout.trim();
}

function sourceTrees(invocation) {
  if (gitText(["rev-parse", "--verify", "HEAD^{commit}"]) !== invocation.sourceSha) fail("site checkout is not exact source");
  return { sourceTree: siteSha(gitText(["rev-parse", "HEAD^{tree}"])), siteTree: siteSha(gitText(["rev-parse", "HEAD:site"])) };
}

function checkedManifest(path, expectedDigest, invocation) {
  const bytes = readFileSync(path);
  if (bytes.length > MAX_JSON || hashBytes(bytes) !== expectedDigest) fail("site build manifest bytes do not match admitted artifact");
  const manifest = parseSiteBuildManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  const trees = sourceTrees(invocation);
  if (manifest.sourceSha !== invocation.sourceSha || manifest.sourceTree !== trees.sourceTree || manifest.siteTree !== trees.siteTree ||
      manifest.siteLockSha256 !== hashBytes(readFileSync("site/bun.lock")) || manifest.ciRunId !== invocation.ciRunId ||
      manifest.ciRunAttempt !== invocation.ciRunAttempt || manifest.buildRunId !== invocation.buildRunId ||
      manifest.buildRunAttempt !== invocation.buildRunAttempt) fail("site manifest does not bind exact source, lockfile and run");
  return manifest;
}

function readReceipt(environment, name) { return decodeProviderReceipt(environment[name], name); }

function boundSubject(environment, invocation) {
  const subject = parseSiteSubject(readReceipt(environment, "SITE_SUBJECT_RECEIPT"));
  for (const key of ["sourceSha", "ciRunId", "ciRunAttempt", "buildRunId", "buildRunAttempt"]) {
    if (subject[key] !== invocation[key]) fail("site subject belongs to another dispatch");
  }
  return subject;
}

export async function siteMain(command, environment = process.env) {
  assertNoAppKey(environment, command === "deny" || command === "promote");
  const invocation = assertSiteInvocation(environment);
  const api = provider.createApi(environment);
  if (command === "verify") {
    await revalidateSiteSource(api, invocation);
    sourceTrees(invocation);
    return;
  }
  if (command === "build-manifest") {
    await revalidateSiteSource(api, invocation);
    const trees = sourceTrees(invocation);
    const manifest = parseSiteBuildManifest({ schema: "textbutler-site-build-v1", repository: SITE_REPOSITORY,
      repositoryId: SITE_REPOSITORY_ID, ...invocation, ...trees,
      siteLockSha256: hashBytes(readFileSync("site/bun.lock")),
      buildManifestSha256: hashBytes(readFileSync("site/.next/build-manifest.json")) });
    const root = join(environment.RUNNER_TEMP, SITE_ARTIFACT_NAME);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
    writeFileSync(join(root, "site-build.json"), bytes, { mode: 0o600, flag: "wx" });
    output("manifest_sha256", hashBytes(bytes));
    return;
  }
  if (command === "admit") {
    checkedManifest(environment.SITE_MANIFEST_PATH, environment.SITE_MANIFEST_SHA256, invocation);
    const artifactId = siteId(environment.SITE_ARTIFACT_ID, "site artifact");
    const artifact = await api.get(`/repos/${SITE_REPOSITORY}/actions/artifacts/${artifactId}`);
    if (!/^[0-9a-f]{64}$/u.test(environment.SITE_ARTIFACT_DIGEST ?? "")) fail("upload artifact output digest is invalid");
    const ci = await revalidateSiteSource(api, invocation);
    const subject = parseSiteSubject({ kind: "site", ...invocation, buildArtifactId: artifactId,
      buildArtifactDigest: `sha256:${environment.SITE_ARTIFACT_DIGEST}`, manifestDigest: environment.SITE_MANIFEST_SHA256,
      buildCompletedAt: siteTimestamp(artifact.created_at, "site artifact creation"), sourceQualifiedAt: ci.completedAt });
    await revalidateSiteSubject(api, subject);
    emitReceipt(subject);
    return;
  }
  const subject = boundSubject(environment, invocation);
  await revalidateSiteSubject(api, subject);
  if (command === "baseline") {
    const receipt = await createProviderBaseline({ api, repository: SITE_REPOSITORY, verifiedSha: subject.sourceSha });
    normalizeBaseline(receipt, subject, true);
    if (receipt.refSha === subject.sourceSha && environment.SITE_CONTROL_EPOCH_DIGEST) fail("control-epoch digest is forbidden for already-exact site recovery");
    emitReceipt(receipt);
    output("ref_sha", receipt.refSha);
    output("advance_required", String(receipt.refSha !== subject.sourceSha));
    return;
  }
  const baselineReceipt = readReceipt(environment, "SITE_BASELINE_RECEIPT");
  if (command === "qualify") {
    const result = await qualifyExistingSiteProduction({ api, subject, baselineReceipt });
    output("deployment_id", String(result.deploymentId));
    output("status_id", String(result.statusId));
    return;
  }
  const { baseline } = normalizeBaseline(baselineReceipt, subject);
  if (command === "workflow") {
    const receipt = verifySiteWorkflowAdmission({ repository: SITE_REPOSITORY, repositoryId: SITE_REPOSITORY_ID,
      previousSha: baseline.refSha, targetSha: subject.sourceSha, workflowSha: subject.sourceSha, currentMainSha: subject.sourceSha,
      githubActions: "true", eventName: "workflow_dispatch", eventRef: "refs/heads/main", eventSha: subject.sourceSha,
      runAttempt: invocation.buildRunAttempt, controlEpochDigest: environment.SITE_CONTROL_EPOCH_DIGEST });
    output("receipt", encodeWorkflowAdmissionReceipt(receipt));
    return;
  }
  const workflowReceipt = decodeWorkflowAdmissionReceipt(environment.SITE_WORKFLOW_RECEIPT);
  assertSiteWorkflowAdmissionReceipt(workflowReceipt, { previousSha: baseline.refSha, targetSha: subject.sourceSha });
  const writerOptions = { environment, repository: SITE_REPOSITORY, workflowSha: subject.sourceSha };
  if (command === "deny") {
    emitReceipt(await proveSiteProductionDenial({ api, subject, baselineReceipt, workflowReceipt,
      preconditionReceipt: environment.AUTHORITY_PRECONDITION_RECEIPT,
      denyRef: options => proveWebsiteProductionSiteRequiredStatusDenial({ ...writerOptions, ...options }) }));
    return;
  }
  const denialReceipt = readReceipt(environment, "SITE_DENIAL_RECEIPT");
  if (command === "promote") {
    emitReceipt(await promoteSiteProduction({ api, subject, baselineReceipt, workflowReceipt, denialReceipt,
      attestationReceipt: environment.AUTHORITY_ATTESTATION_RECEIPT,
      advanceRef: options => advanceWebsiteProductionSiteRef({ ...writerOptions, ...options }) }));
    return;
  }
  const promotionReceipt = readReceipt(environment, "SITE_PROMOTION_RECEIPT");
  const finalizeInput = { denialReceipt, preconditionReceipt: environment.AUTHORITY_PRECONDITION_RECEIPT,
    attestationReceipt: environment.AUTHORITY_ATTESTATION_RECEIPT, consumptionReceipt: environment.AUTHORITY_CONSUMPTION_RECEIPT };
  if (command === "finalize") {
    const receipt = await finalizeProductionAuthority({ api, ...finalizeInput, promotion: promotionReceipt });
    if (!same(receipt.promotion.subject, subject)) fail("site finalizer subject mismatch");
    emitReceipt(receipt);
    return;
  }
  if (command === "wait") {
    const result = await waitForSiteProduction({ api, subject, baselineReceipt, promotionReceipt, finalizeInput });
    output("deployment_id", String(result.deploymentId));
    output("status_id", String(result.statusId));
    return;
  }
  fail("unknown site promotion operation");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [command, ...extra] = process.argv.slice(2);
  if (extra.length || !["verify", "build-manifest", "admit", "baseline", "workflow", "deny", "promote", "finalize", "wait", "qualify"].includes(command)) {
    fail("Usage: site-production.mjs verify|build-manifest|admit|baseline|workflow|deny|promote|finalize|wait");
  }
  siteMain(command).catch(error => {
    if (error instanceof ControlEpochAdmissionError && error.receipt) writeControlEpochReview(error.receipt);
    process.stderr.write(`::error::${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
