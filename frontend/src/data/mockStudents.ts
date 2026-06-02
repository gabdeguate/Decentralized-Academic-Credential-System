// Mock registry used by Verifier search (Phase 3) and the Create Account
// signup form (Phase 2). Hand-edit the arrays below as you add test wallets.
//
// Self-signed students get appended to localStorage at runtime
// (key `dacs:profile:<addr>`); the Verifier search will read the union of
// MOCK_STUDENTS and the localStorage profiles.

export interface MockStudent {
  name:          string;
  walletAddress: string; // 0x… checksum or lower — comparison is case-insensitive
  school:        string; // must be one of MOCK_SCHOOLS
}

export interface MockIssuer {
  name:          string;
  walletAddress: string;
  email:         string; // used by Phase 3 "Request Re-issuance" mailto button
}

export const MOCK_SCHOOLS: readonly string[] = [
  "MIT",
  "ETHZ",
  "Stanford",
  "NUS",
];

export const DEGREE_LEVELS: readonly string[] = [
  "Bachelor",
  "Master",
  "PhD",
];

// Single source of truth — department → majors offered in that department.
// DEPARTMENTS is derived from the keys so the two can never drift.
export const MAJORS_BY_DEPT: Record<string, readonly string[]> = {
  "Engineering": [
    "Computer Science",
    "Electrical Engineering",
    "Mechanical Engineering",
    "Civil Engineering",
    "Bioengineering",
    "Chemical Engineering",
    "Aerospace Engineering",
    "Industrial Engineering",
  ],
  "Sciences": [
    "Mathematics",
    "Statistics",
    "Data Science",
    "Physics",
    "Chemistry",
    "Biology",
    "Neuroscience",
    "Environmental Science",
  ],
  "Business": [
    "Economics",
    "Finance",
    "Business Administration",
    "Marketing",
    "Accounting",
    "Management",
  ],
  "Social Sciences": [
    "Psychology",
    "Sociology",
    "Political Science",
    "International Relations",
    "Anthropology",
  ],
  "Arts & Humanities": [
    "History",
    "English Literature",
    "Philosophy",
    "Art History",
    "Linguistics",
    "Architecture",
    "Music",
    "Film Studies",
  ],
  "Medicine": [
    "Medicine",
    "Nursing",
    "Public Health",
    "Pharmacy",
    "Dentistry",
  ],
  "Law": [
    "Law",
    "Legal Studies",
  ],
  "Education": [
    "Education",
    "Curriculum Studies",
    "Educational Psychology",
  ],
};

export const DEPARTMENTS: readonly string[] = Object.keys(MAJORS_BY_DEPT);

export const MOCK_STUDENTS: MockStudent[] = [
  // { name: "Alice", walletAddress: "0x…", school: "MIT" },
];

export const MOCK_ISSUERS: MockIssuer[] = [
  // { name: "MIT Registrar", walletAddress: "0x…", email: "registrar@mit.edu" },
];
