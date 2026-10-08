import { SetMetadata } from '@nestjs/common';
export const EmployeeAccess = () => SetMetadata('employeeAccess', true);
export const PublicAccess = () => SetMetadata('publicAccess', true);
