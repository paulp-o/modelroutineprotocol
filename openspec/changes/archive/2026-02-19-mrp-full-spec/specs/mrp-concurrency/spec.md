## ADDED Requirements

### Requirement: Per-Routine Lockfile
The system SHALL use a lockfile at `.mrp/routines/<routine_id>/routine.lock` to serialize operations on a single routine (ledger writes, run artifact creation, routine.yaml modifications).

#### Scenario: Concurrent runs of same routine serialize
- **WHEN** two agents attempt `mrp run` on the same routine simultaneously
- **THEN** the second agent waits for the first to release the lock before proceeding

#### Scenario: Lock acquisition timeout
- **WHEN** a lock cannot be acquired within 10 seconds
- **THEN** the command fails with `error.code: LOCK_TIMEOUT` and a message indicating which lock is held

### Requirement: Global Store Lock
The system SHALL use a lockfile at `.mrp/locks/store.lock` for global store operations: index updates, projection sync, config modifications, and discovery state writes.

#### Scenario: Index update acquires store lock
- **WHEN** `mrp create` updates the index
- **THEN** the store lock is acquired before writing and released after

#### Scenario: Concurrent different routines
- **WHEN** two agents run different routines simultaneously
- **THEN** both proceed concurrently (different routine locks), only serializing on shared store operations

### Requirement: Atomic File Writes
All file writes to `.mrp/` SHALL use atomic write semantics: write to a temporary file in the same directory, then rename to the target path. This prevents partial writes on crash.

#### Scenario: Atomic routine.yaml write
- **WHEN** `mrp edit` updates routine.yaml
- **THEN** the system writes to `routine.yaml.tmp`, validates contents, then renames to `routine.yaml`

#### Scenario: Crash during write
- **WHEN** the process crashes during a file write
- **THEN** the original file remains intact (the .tmp file may be orphaned and cleaned by `mrp doctor`)

### Requirement: Lock File Format
Lockfiles SHALL contain the PID of the owning process as plain text. This enables stale lock detection.

#### Scenario: Lock contains PID
- **WHEN** a lock is acquired
- **THEN** the lockfile contains the current process PID

### Requirement: Stale Lock Detection
When a lock cannot be acquired, the system SHALL check if the PID in the lockfile corresponds to a running process. If the process is not running, the lock is considered stale and SHALL be removed before retrying.

#### Scenario: Stale lock from crashed process
- **WHEN** a lockfile contains PID 12345 but no process with PID 12345 is running
- **THEN** the system removes the stale lock and acquires it

#### Scenario: Valid lock from running process
- **WHEN** a lockfile contains PID 12345 and the process is still running
- **THEN** the system waits and retries (up to 10s timeout)

### Requirement: Lock Cleanup via Doctor
`mrp doctor` SHALL detect and remove orphaned lockfiles (where the owning PID is no longer running) and orphaned `.tmp` files from interrupted atomic writes.

#### Scenario: Doctor removes stale locks
- **WHEN** `mrp doctor` finds a lockfile with a dead PID
- **THEN** it removes the lockfile and reports `issue: stale_lock`

#### Scenario: Doctor removes orphaned tmp files
- **WHEN** `mrp doctor` finds `routine.yaml.tmp` files
- **THEN** it removes them and reports `issue: orphaned_tmp_file`
