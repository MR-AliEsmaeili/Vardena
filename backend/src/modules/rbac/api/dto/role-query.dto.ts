import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';

/**
 * Role list query: the kernel pagination contract, including its `sort`
 * syntax (`field:(asc|desc)`). Which fields are actually sortable
 * (`name`, `createdAt`, `updatedAt`) is enforced by the service, never by
 * trusting the query string (architecture.md §9).
 */
export class ListRolesQueryDto extends PageQueryDto {}
