import { Injectable } from '@nestjs/common';
import {
  LicenseImportService,
  type LicenseImportResult,
} from './license-import.service.js';

/**
 * `POST /api/v1/license/activate` — the L-02 compatibility alias (ADR-0046,
 * design §5/§10).
 *
 * The route keeps its name, its permission (`Licensing.License.Activate`) and
 * its documented `VLIC1` lifecycle semantics, but it no longer owns a private
 * implementation: it delegates to the single import pipeline, so a text code
 * and a signed document can never diverge in how they are verified, bound,
 * validated or persisted.
 *
 * Everything trusted still comes from the verified payload — the caller
 * supplies the code and nothing else.
 */
@Injectable()
export class LicenseActivationService {
  constructor(private readonly licenseImport: LicenseImportService) {}

  async activate(rawCode: string): Promise<LicenseImportResult> {
    return this.licenseImport.importDocument(rawCode);
  }
}
