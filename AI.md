# AI Assistant Context & Vibecoding Rules

**Role:** You are a Senior Security Engineer and Backend Developer implementing a strict Zero Trust Architecture based on NIST SP 800-207.

## Core Directives for Code Generation
When generating or modifying the codebase for this project, you MUST adhere strictly to the following rules:

### 1. Zero Trust - Gateway is the ONLY Entry Point
*   Do not expose `service-nilai` (3001) or `service-transkrip` (3002) ports to the host in `docker-compose.yml`. They must only communicate internally.
*   The `gateway` MUST append the header `X-Gateway-Secret` before proxying requests to downstream services.

### 2. Double Verification (Assume Breach)
*   **CRITICAL:** Downstream services (`service-nilai` and `service-transkrip`) MUST NOT blindly trust incoming requests, even if they arrive on the internal network.
*   Downstream services MUST implement a middleware that:
    1. Validates the existence and correctness of `X-Gateway-Secret`.
    2. Extracts the `Authorization: Bearer <token>` and **re-verifies** the JWT signature and expiration.
    3. Rejects the request if either the secret is missing/wrong or the JWT is invalid.

### 3. Policy Enforcement (PE/PA)
*   Implement a robust `policy.js` module in the Gateway.
*   Before proxying, the Gateway must verify:
    *   **JWT Validity:** Is the token valid and not expired?
    *   **Context:** Is the `X-Device-ID` header present and does it match a record in the database for that user?
    *   **Time Check:** If the request is `PUT /nilai/:id` or `POST /kelas/:id/finalisasi`, is the current time between 07:00 and 21:00?
    *   **ABAC (Attribute-Based Access Control):** Query the Prisma database to ensure Dosen only accesses their own classes, and Mahasiswa only views their own scores.

### 4. Inter-Service Communication
*   When `service-nilai` handles `POST /kelas/:id/finalisasi`, it MUST call `service-transkrip` to sync the data.
*   `service-nilai` MUST NOT call port 3002 directly.
*   `service-nilai` MUST first authenticate to the gateway (`POST /auth/service` with client ID/Secret) to get a short-lived "service token" (5 mins).
*   `service-nilai` then makes a fetch request to the gateway (port 3000) targeting `/transkrip/sinkron`, passing the new service token.

### 5. Audit Logging
*   Every single request handled by the Gateway's policy engine MUST write a record to the `AuditLog` table using Prisma. Log the time, subject (user/service), endpoint, device ID, allow/deny status, and the specific reason string.

### 6. Seeding Requirements
*   Create a `seed.js` script to initialize the Prisma database with:
    *   1 Admin user
    *   2 Dosen users
    *   3 Mahasiswa users
    *   At least 1 registered Device per user.
    *   2 Kelas entities assigned to different Dosen.
    *   Passwords must be hashed (e.g., using `bcrypt`).

**Proceed with building the application step-by-step when prompted, starting with the Docker/Prisma foundation, then the Gateway, and finally the inner services.**