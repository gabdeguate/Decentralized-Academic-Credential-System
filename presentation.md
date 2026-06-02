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

Three kinds of people use the system:

| Role | What they do |
|---|---|
| **School (Issuer)** | Issues diplomas to students |
| **Student (Holder)** | Receives diplomas, controls who can see them |
| **Verifier (Employer)** | Checks whether a diploma is real |
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
fingerprint is built **the same way on the website and inside the contract**, so the
two always agree — the technical term is `solidityPackedKeccak256`.

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

Why this matters: the website doesn't keep its own private database that could get
out of sync or be tampered with. Instead, **the website rebuilds everything by
reading the blockchain's event history.** When a student logs in, the page asks the
blockchain "show me every diploma ever issued to this wallet" and displays them.
The blockchain is the single source of truth.

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
4. **None of the above?** → a sign-up / "application pending" screen

It checks all of these by reading the blockchain the moment you connect. The admin
is recognized both by being the contract's official owner **and** by a built-in
allowlist of admin wallet addresses, so the right person always lands on the admin
view.

> **In one line:** your wallet is your login, and the system routes you to the
> correct dashboard automatically.

---

## 6. Sign-up and approval flow (admin validation)

We didn't want anyone to be able to issue fake diplomas, so both schools and
students must be **approved by the Admin** before they can participate.

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

1. School uploads the diploma PDF → Pinata returns a CID.
2. The contract stores only a short reference, `ipfs://<CID>`, alongside the
   diploma's fingerprint.
3. Later, a student or verifier downloads the PDF straight from IPFS using that
   reference.

> **In one line:** big files live on IPFS (tamper-evident, cheap); the blockchain
> only stores a tiny pointer to them.

---

## 8. The student controls who sees their diploma (access control)

A diploma belongs to the student, not the school or an employer. So **only the
student can grant or revoke viewing access.**

When a student wants an employer to verify their degree, they add that employer's
wallet to the diploma's **allowlist**. The employer can then run a verification and
get a clear ✅ or ❌. If the student later removes them, the employer loses access.

When a verifier checks a diploma, the contract runs through a strict checklist in
order and returns the first problem it finds:

1. Does this diploma exist?
2. Is the issuing school still approved?
3. Has the diploma been revoked?
4. Is the person asking actually on the allowlist?

Only if all four pass does it return "valid."

A logged-in employer gets their own **Verifier dashboard**: they re-enter the diploma
details the student gave them, the page rebuilds the same fingerprint, and they get an
instant ✅ or ❌. (For a quick check without logging in at all, see the public lookup in
section 10.)

> **In one line:** the student is in charge of their own privacy — verification is
> permission-based, not open to the world.

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
and **request a re-issuance** — for example if a name or major was misspelled. The
request appears in the issuing school's dashboard, where the school can correct the
details and issue a fresh diploma in one click.

> **In one line:** one student, many schools, one tidy view — grouped and labeled in
> plain English.

---

## 10. Anyone can verify a diploma — no login needed (public lookup)

Employers and registrars often just want to **check** a diploma, not log in. The home
page has a **"Verify a Credential"** box: paste a student's wallet address, hit
**Search**, and you land on a full results page that looks just like the student
dashboard — **no wallet, no login**.

That page shows every credential issued to that wallet, **grouped by the university**
that issued it (by readable name), and for each one:

- the **degree** (e.g. "Bachelor of Computer Science"), pulled from the diploma's
  stored details,
- a **View PDF** link to the actual diploma on IPFS,
- a **View on Etherscan** link to the exact blockchain transaction that issued it — so
  anyone can independently confirm it happened and was never tampered with,
- and its status badge: ✓ Active, ✗ Revoked, or ⚠ issuer no longer registered.

> **In one line:** paste an address, instantly see real degrees, real diplomas, and the
> on-chain proof behind each — without an account.

---

## 11. How a diploma's whole life looks (end-to-end)

Putting it all together, here is the journey of a single diploma:

1. **School applies** → Admin approves it into the Registry.
2. **Student applies** → Admin approves them too.
3. **School issues a diploma**: uploads the PDF to IPFS, the website computes the
   keccak256 fingerprint, and the contract records the fingerprint + IPFS pointer,
   emitting a permanent event.
4. **Student logs in**, sees the diploma on their dashboard, downloads the PDF.
5. **Student grants an employer access.**
6. **Employer verifies** → gets ✅ valid, and can download the same PDF to read it.
7. *(If needed)* **School revokes** the diploma → it permanently shows as invalid to
   everyone.

Every step above is enforced by code and recorded on a public, unchangeable ledger.

---

## 12. Quality and safety practices

- **Automated tests:** the contracts ship with **104 automated tests** covering every
  rule — who can do what (admins, schools, students), what happens on bad input, and a
  full apply → approve → issue → verify → revoke lifecycle. They all pass.
- **Public verification:** both contracts are **verified on Etherscan**, meaning the
  exact source code is published and anyone can read or audit it.
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
| **Sepolia** | Ethereum's free practice network we deployed on |
