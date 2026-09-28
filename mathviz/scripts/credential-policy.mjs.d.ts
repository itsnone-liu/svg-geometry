export interface CredentialGate {
  policy: string;
  validPolicy: boolean;
  credentialPresent: boolean;
  riskAck: boolean;
  rotationConfirmed: boolean;
  policyPass: boolean;
  authorizedBeforeProvider: boolean;
  details: Record<string, string | boolean>;
}
export function evaluateCredentialGate(options?: { policyText?: string; rotationText?: string; env?: Record<string, string | undefined> }): CredentialGate;
export function fields(text?: string): Record<string, string>;
