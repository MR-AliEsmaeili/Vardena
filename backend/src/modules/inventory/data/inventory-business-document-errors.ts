/**
 * The organization's calendar changed after the application validated a
 * BusinessDate but before the document write acquired the organization row
 * lock. The request must be retried against the current calendar policy.
 */
export class OrganizationCalendarChangedDuringDocumentWriteError extends Error {
  constructor() {
    super('Organization calendar changed during the Inventory document write.');
    this.name = 'OrganizationCalendarChangedDuringDocumentWriteError';
  }
}
