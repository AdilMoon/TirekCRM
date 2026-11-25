import type {BusinessTask} from './index';
export interface EmployeeWorkflow {
 task:BusinessTask;
 resultPhotos:number;
 submittedMinutes:number;
 approvedMinutes:number;
 requiredChecks:number;
 completedChecks:number;
}
export interface EmployeeFirstDay {workflow:EmployeeWorkflow|null}
