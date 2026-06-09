# DACS — Decentralized Academic Credential System

### A plain-language guide to what we built and how it works

This document explains every part of the system in everyday terms, then names the
technique behind each part so the technical details are there if someone asks.
You should be able to read this top-to-bottom without a programming background.

---

## 1. The big picture (the problem we solve)

Today a diploma is a piece of paper or a PDF. It can be faked, and an employer who
wants to check it has to phone the university and wait. **DACS replaces that trust
problem with math.**

Four roles appear in the system, but only schools and students create applicant
accounts:

| Role | What they do |
|---|---|
| **School (Issuer)** | Issues diplomas to students |
| **Student (Holder)** | Receives diplomas, controls who can see them |
| **Verifier (Employer / Company)** | Uses public search, or connects an allowlisted wallet to run the stricter verification check |
| **Admin** | Approves which schools and students are allowed in |

The system is built on a **blockchain** (Ethereum). Think of the blockchain as a
public notebook that everyone shares, nobody can erase, and nobody can secretly
edit. Once something is written in it, it is permanent and visible to all.

We deployed to **Sepolia**, which is Ethereum's free practice network — same
technology as the real thing, but with play-money so testing costs nothing.

---

## 2. The digital fingerprint (keccak256 hashing)

**The idea:** We never put a student's actual diploma data on the public
blockchain — that would expose private information forever. Instead we store a
**fingerprint** of it.

**How it works:** We take the diploma details — the student's wallet, the degree
type, and the graduation date — and run them through a function called
**keccak256**. This produces a 64-character code that looks like random gibberish,
for example `0x9af2...c41b`.

Two important properties make this useful:

- **Same input always gives the same fingerprint.** So anyone can re-create the
  fingerprint from the original diploma and check it matches.
- **You cannot run it backwards.** Given the fingerprint, there is no way to figure
  out the original diploma details. It is a one-way street.

This is the same family of math that secures passwords and Bitcoin. In our code the
website builds the fingerprint with ethers' `solidityPackedKeccak256`, matching
Solidity's packed encoding. The contract itself never receives the raw diploma
fields or recomputes them; it stores and checks the finished `bytes32` fingerprint.

> **In one line:** the blockchain stores a tamper-proof fingerprint, never the
> private diploma itself.

---

## 3. The two smart contracts (the rulebook on the blockchain)

A **smart contract** is a small program that lives on the blockchain. Once
deployed, it runs exactly as written and **no one can change its rules** — not even
us. We wrote two of them.

### 3a. RegistryContract — the "who is allowed" list

This is the gatekeeper. It keeps two lists: **approved schools** and **approved
students**, and it also remembers **pending applications** that are waiting for a
decision.

Who can do what:

- **Admins** approve or reject schools and students, and add or remove them from the
  approved lists.
- The system supports **more than one admin**. There is always a head admin (the
  contract's *owner*), and the owner can appoint or remove additional admins — handy
  when a registrar's office has several staff sharing the workload.
- Only the **owner** can change the admin list itself; ordinary admins cannot.

Technique: these powers are enforced in code with an `onlyAdmin` check, built on the
standard, audited **OpenZeppelin Ownable** library. If anyone without the right role
calls a protected function, the blockchain rejects it automatically.

### 3b. CredentialContract — the diploma ledger

This handles the diplomas themselves. It can:

- **Issue** a diploma (only an approved school can do this)
- **Revoke** a diploma (only the school that issued it — useful if a diploma was
  issued by mistake or a degree is rescinded)
- **Verify** a diploma (anyone the student has authorized)
- **Grant / revoke viewing access** (only the student who owns the diploma)

Each rule is enforced in code. For example, the contract literally checks
"is the person calling this an approved school?" before letting a diploma be issued.
If not, it stops with a clear error like `NotAuthorizedIssuer`.

> **In one line:** the Registry decides *who* is allowed; the Credential contract
> records *what* diplomas exist and *who can see them*.

---

## 4. Permanent, honest history (events)

Every time something happens — a school is approved, a diploma is issued, a diploma
is revoked — the contract writes a permanent note called an **event**.

Why this matters: for approvals, issuances, revocations, and access grants, the
website does not keep a separate private database that could get out of sync or be
tampered with. Instead, **the website rebuilds the core credential state by reading
the blockchain's event history.** When a student logs in, the page asks the
blockchain "show me every diploma ever issued to this wallet" and displays them.
PDFs and readable metadata live on IPFS, while a few prototype conveniences like
local labels and re-issuance requests live in browser `localStorage`.

Technique: this is called an **event-driven** design. We query past events with
filters (e.g. "all diplomas for this student") to reconstruct the current state.

---

## 5. Logging in with a crypto wallet (MetaMask)

There are no usernames or passwords. Instead, users connect a **MetaMask wallet** —
a browser extension that holds a person's blockchain identity.

**Why this is more secure:** a wallet proves who you are using a secret key that
never leaves your device. You approve each action by clicking "Confirm" in MetaMask.
Nobody can impersonate you without your physical device and approval.

### Smart role routing

When you connect your wallet, the website automatically figures out who you are and
sends you to the right dashboard — no menus to pick from:

1. **Are you the Admin?** → Admin dashboard
2. **Are you an approved school?** → Issuer dashboard
3. **Are you a student / do you hold diplomas?** → Student dashboard
4. **Are you an allowlisted verifier wallet?** → Verifier dashboard
5. **None of the above?** → student/school application screen, or use public
   credential search without an account

It checks all of these by reading the blockchain the moment you connect. The admin
view is shown for the contract owner, any on-chain admin, and a small frontend
allowlist of admin wallet addresses. That allowlist only affects routing; protected
on-chain actions still require the wallet to be the owner or an on-chain admin.

> **In one line:** your wallet is your login, and the system routes you to the
> correct dashboard automatically.

---

## 6. Sign-up and approval flow (admin validation)

We didn't want anyone to be able to issue fake diplomas or claim a student profile,
so both schools and students must be **approved by the Admin** before they can
participate. Employers and companies do **not** create DACS accounts; they use public
search, or a wallet that a student has explicitly allowlisted for contract-level
verification.

**The flow:**

1. A school (or student) fills in a short application on the website. Their details
   are saved to **IPFS** (explained below) and an **application request** is recorded
   on the blockchain.
2. The Admin opens the **Admin dashboard**, which lists all pending school
   applications and all pending student applications in one place.
3. The Admin clicks **Approve** or **Reject** (with a reason). Approval adds them to
   the Registry's allowed list; rejection records why.
4. The applicant sees their status next time they log in — approved, pending, or
   rejected-with-reason (and they can re-apply).

The admin dashboard also has a **Manage Admins** panel (shown only to the owner) for
appointing or removing other admins, so approval duties can be shared across a team
instead of resting with one person.

Technique: applications and decisions are all recorded as on-chain events and
status flags (`Pending`, `Rejected`, or approved). Because rejection reasons are
stored on-chain, the applicant always sees an honest explanation.

> **In one line:** nobody self-certifies — a human admin approves every school and
> student, and every decision is logged permanently.

---

## 7. Storing the actual diploma PDF (IPFS via Pinata)

The blockchain is great for fingerprints and rules, but it is expensive and public —
a bad place to store an actual PDF file. So we store the diploma document on **IPFS**.

**What IPFS is:** a decentralized file storage network. When you upload a file, IPFS
gives back a unique address called a **CID** that is derived from the file's
contents. If even one pixel of the file changes, the CID changes — so the address
itself proves the file hasn't been altered.

We use **Pinata**, a service that keeps IPFS files reliably online. The flow:

1. School uploads the diploma PDF → Pinata returns a PDF CID.
2. The website pins a small JSON metadata sidecar containing readable degree fields
   and that PDF CID → Pinata returns a second CID.
3. The contract stores only `ipfs://<sidecar CID>` alongside the diploma's
   fingerprint.
4. Later, dashboards read the sidecar and use its PDF CID to open or download the
   actual diploma from IPFS.

> **In one line:** big files live on IPFS (tamper-evident, cheap); the blockchain
> only stores a tiny pointer to them.

---

## 8. The student controls who sees their diploma (access control)

A diploma belongs to the student, not the school or an employer. So **only the
student can grant or revoke viewing access.**

When a student wants an employer to run the stricter contract check, they add that
employer's wallet to the diploma's **allowlist**. The employer does not apply for an
account; they connect that wallet and get a clear ✅ or ❌ from `verifyCredential`.
If the student later removes them, that wallet loses verifier-dashboard access.

When a verifier checks a diploma, the contract runs through a strict checklist in
order and returns the first problem it finds:

1. Does this diploma exist?
2. Is the issuing school still approved?
3. Has the diploma been revoked?
4. Is the person asking actually on the allowlist?

Only if all four pass does it return "valid."

An allowlisted employer wallet can use the **Verifier dashboard**: they re-enter the
diploma details the student gave them, the page rebuilds the same fingerprint, and
the contract returns an instant ✅ or ❌ based on the current allowlist and status.
(For a read-only public record lookup without logging in at all, see section 10.)

> **In one line:** the student controls the contract's yes/no verification flow; the
> separate public lookup is a read-only event and metadata browser.

---

## 9. Diplomas from many schools, organized clearly (student dashboard)

A real student might collect degrees from several universities over a lifetime. The
student dashboard pulls **every** diploma issued to their wallet — no matter which
school issued it — and **groups them under each school's name** with that school's
diploma cards beneath.

Nice touch: schools are shown by their **readable name** (pulled from their original
application) instead of a cryptic wallet address. If a school was added directly by
the admin and has no application on file, the dashboard gracefully falls back to
showing its short address.

Each diploma card also lets the student **download the PDF**, **manage who can see it**,
and **request a re-issuance** — for example to get a fresh copy after an old one was
revoked. Importantly, for current JSON-backed credentials, the student **cannot change
any diploma details**: the degree, major, dates, and everything else stay locked. They
fill in only a short **reason** for the request. In this prototype, that request is a
same-browser `localStorage` queue item that appears in the issuing school's dashboard.
When the school approves, the on-chain part happens: it **revokes the old diploma and
issues a brand-new one with the exact same details**. Anyone who later looks up that
student's wallet sees **both** copies — the old one marked *Revoked* and the new one
marked *Active*, each with its issue date — so the most recent valid diploma is always
clear.

(Behind the scenes, the blockchain refuses to store the same fingerprint twice, even
after a diploma is revoked. So the student's reason is mixed into the fingerprint, giving
the new copy its own unique code while keeping every diploma detail identical.)

> **In one line:** one student, many schools, one tidy view — grouped and labeled in
> plain English.

---

## 10. Anyone can look up public records — no login needed (public lookup)

Employers, companies, and registrars often just want to **inspect public credential
records**, not create an account. The home page has a **Credential search** panel:
paste a student's wallet address, hit
**Search**, and you land on a full results page that looks just like the student
dashboard — **no wallet, no login**.

That page shows every credential issued to that wallet, **grouped by the university**
that issued it (by readable name), and for each one:

- the **degree** (e.g. "Bachelor of Computer Science"), pulled from the IPFS metadata
  sidecar when available,
- a **View PDF** link to the actual diploma on IPFS,
- a **View on Etherscan** link to the exact blockchain transaction that issued it — so
  anyone can independently confirm it happened and was never tampered with,
- and its status badge: ✓ Active, ✗ Revoked, or ⚠ issuer no longer registered.

> **In one line:** paste an address, instantly see issued credential records, diploma
> links, and the on-chain proof behind each — without an account.

---

## 11. How a diploma's whole life looks (end-to-end)

Putting it all together, here is the journey of a single diploma:

1. **School applies** → Admin approves it into the Registry.
2. **Student applies** → Admin approves them too.
3. **School issues a diploma**: uploads the PDF and JSON sidecar to IPFS, the website
   computes the keccak256 fingerprint, and the contract records the fingerprint + sidecar
   pointer, emitting a permanent event.
4. **Student logs in**, sees the diploma on their dashboard, downloads the PDF.
5. **Student grants an employer wallet access** if the employer needs the allowlisted
   contract check.
6. **Employer checks the credential** → either uses public search without an account,
   or connects the allowlisted wallet and gets ✅ valid from `verifyCredential`.
7. *(If needed)* **School revokes** the diploma → it permanently shows as invalid to
   everyone.
8. *(If needed)* **Student requests a re-issuance** — reason only, all details locked →
   the prototype stores that request in browser localStorage → the school approves →
   the old copy is revoked and an identical new copy is issued on-chain. Both appear
   under the student's wallet: old as *Revoked*, new as *Active*.

Every contract action above is enforced by code and recorded on a public, unchangeable
ledger; the current re-issuance request handoff is frontend-local prototype state.

---

## 12. Quality and safety practices

- **Automated tests:** the contracts ship with **104 automated tests** covering every
  rule — who can do what (admins, schools, students), what happens on bad input, and a
  full apply → approve → issue → verify → revoke lifecycle. They all pass.
- **Public chain history:** deployed addresses and issuance transactions are visible
  on Sepolia Etherscan, so anyone can inspect the on-chain activity and proofs.
- **Trusted building blocks:** we use **OpenZeppelin**, the industry-standard,
  audited library, for the admin-permission logic rather than rolling our own.
- **Secrets stay secret:** API keys and private keys live in local files that are
  never committed to the code repository.

---

## Glossary (one line each)

| Term | Plain meaning |
|---|---|
| **Blockchain** | A shared, permanent, tamper-proof public notebook |
| **Smart contract** | A program on the blockchain whose rules can't be changed |
| **keccak256 / hash** | A one-way "fingerprint" of data |
| **Wallet / MetaMask** | Your blockchain identity and login |
| **Event** | A permanent note the contract writes when something happens |
| **IPFS / CID** | Decentralized file storage; the CID is the file's tamper-proof address |
| **Pinata** | A service that keeps our IPFS files online |
| **Issuer / Holder / Verifier** | School / Student / Employer |
| **Admin / Owner** | Admins approve schools & students; the owner is the head admin who can appoint other admins |
| **onlyAdmin / onlyOwner** | A rule that lets only an admin (or only the owner) run a function |
| **Revoke** | Permanently mark a diploma (or an access grant) as no longer valid |
| **Re-issuance** | Student asks for a fresh copy (reason only, details locked); the prototype queues the request in localStorage, then the school revokes the old credential and issues an identical new one on-chain |
| **Sepolia** | Ethereum's free practice network we deployed on |
