/**
 * Error types that the CLI can render without a stack trace.
 *
 * Anything else is a genuine bug and keeps its stack.
 */

/** A user-facing failure with an exit code (default 1). */
export class ToolError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'ToolError';
    this.exitCode = exitCode;
  }
}

/** A command-line usage problem (default exit code 2). */
export class UsageError extends ToolError {
  constructor(message, { command, exitCode = 2 } = {}) {
    super(message, exitCode);
    this.name = 'UsageError';
    this.command = command;
  }
}
