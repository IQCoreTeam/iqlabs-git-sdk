# iqlabs-git-sdk — TODO

글로벌 투두: [../iq-git-cli/IQGIT-V2-TODO.md](../iq-git-cli/IQGIT-V2-TODO.md)

---

## 스캐폴딩

- [ ] `git init` + `npm init`
- [ ] `package.json`
  - [ ] `name: "@iqlabs/git"`
  - [ ] `exports` map: `.`, `./browser`, `./node`
  - [ ] `peerDependencies`: `@solana/web3.js`, `iqlabs-sdk`, `buffer`
  - [ ] `sideEffects: false`
- [ ] `tsconfig.json` (strict 모두 on)
- [ ] 빌드 (rollup 또는 tsup) — 3 타겟 (shared / browser / node)
- [ ] eslint 설정 + `no-restricted-imports` 로 레이어 위반 차단
- [ ] vitest 설정

## L0 core/

- [ ] `core/types.ts` — `Repository`, `Commit`, `FileTree`, `Ref`
- [ ] `core/seed.ts` — table_hint 규약 (`git_repos_v2_<owner>`, `git_commits:<owner>:<repo>`, `git_repos:all`)
- [ ] `core/chunk.ts` — byte-safe chunking (iq-git-cli 의 chunk.ts 이식)
- [ ] `core/hash/index.ts` + `node.ts` (node:crypto) + `browser.ts` (SubtleCrypto)
- [ ] `core/codec/base64.ts`, `core/codec/json.ts`
- [ ] `core/errors.ts` — `GitError`, `NotFound`, `WriteDenied` 등

## L0 wallet/

- [ ] `wallet/signer.ts` — `Signer` 인터페이스
- [ ] `wallet/keypair-signer.ts` — Node keypair → Signer
- [ ] `wallet/adapter-signer.ts` — Browser `WalletAdapter` → Signer

## L1 chain/

- [ ] `chain/chain-adapter.ts` — 인터페이스 (`readRows`, `writeRow`, `createTable`, `getSignaturesForAddress`, `readCodeIn`)
- [ ] `chain/iqlabs-chain-adapter.ts` — iqlabs-sdk 실구현
- [ ] `chain/gateway-fallback.ts` — `/table/<pda>/rows` 우선, SDK fallback
- [ ] `chain/rate-limit.ts` — 큐 + 재시도
- [ ] `chain/pda.ts` — getDbRootPda / getTablePda 래퍼
- [ ] chain mock (테스트용 fake adapter)

## L2 storage/

- [ ] `storage/blob-store.ts` — codeIn 업로드 + hash→txId 인덱스 + retry
- [ ] `storage/tree-store.ts` — tree.json 직렬화 / 업로드 / 파싱
- [ ] `storage/tree-walker.ts` — tree → 파일 복원 (checkout 용)
- [ ] `storage/manifest.ts` — FileTree 헬퍼

## L3 model/

- [ ] `model/repo-service.ts` — `git_repos_v2_<owner>` CRUD + `git_repos:all` 등록
- [ ] `model/commit-service.ts` — `git_commits:<owner>:<repo>` 관리
  - [ ] `ensureCommitTable(owner, repo)` — writers=[owner] 로 createTable
  - [ ] `writeCommitRow(owner, repo, commit)` — 신규 row 추가
  - [ ] `getLatestCommit(owner, repo)` — `readTableRows({limit:1})`
  - [ ] `getHistory(owner, repo)` — 전체 + 정렬
- [ ] `model/registry-service.ts` — `git_repos:all` read (갤러리)
- [ ] `model/collaborator-service.ts` — writers 확장 (후속)

## L4 client/

- [ ] `client/git-client.ts` — facade
  - [ ] `createRepo(name, { isPublic })`
  - [ ] `commit(repo, message)`
  - [ ] `log(owner, repo)`
  - [ ] `clone(owner, repo, outputDir)`
  - [ ] `checkout(commitId, outputDir)`
  - [ ] `status(repo)`
  - [ ] `setVisibility(repo, isPublic)`
- [ ] workflow 분리 (`workflow-commit.ts`, `workflow-checkout.ts`, `workflow-clone.ts`)

## 엔트리

- [ ] `src/index.ts` (shared)
- [ ] `src/browser.ts` (WalletAdapter signer + Web Crypto)
- [ ] `src/node.ts` (keypair signer + node crypto + fs)

## 스크립트

- [ ] `scripts/bootstrap-registry.ts` — `git_repos:all` createTable (writers=[], 1회, admin key)

## 테스트

- [ ] L0 / L1 단위 테스트
- [ ] L2 / L3 fake chain adapter 시나리오
- [ ] L4 integration (solana-test-validator, CI tag)

## 퍼블리시

- [ ] 0.1.0-rc.1 publish (전환기용)
- [ ] 0.1.0 정식 릴리스
