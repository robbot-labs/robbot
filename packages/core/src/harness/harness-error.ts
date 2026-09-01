export type HarnessErrorCode =
  | 'runtime_not_found'
  | 'runtime_not_ready'
  | 'transport_error'
  | 'protocol_error'
  | 'sdk_prompt_timeout'
  | 'sdk_request_timeout'
  | 'sdk_run_timeout'
  | 'run_timeout'
  | 'runtime_terminated'
  | 'run_interrupted'
  | 'unsupported_capability'
  | 'unknown';

export class HarnessError extends Error {
  readonly code: HarnessErrorCode;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: HarnessErrorCode = 'unknown',
    cause?: unknown,
  ) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
    this.cause = cause;
  }
}
