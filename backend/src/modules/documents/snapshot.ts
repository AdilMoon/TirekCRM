import type {ClientInput,DocumentSnapshot,OrganizationInput} from '@tirek/contracts';
export function clientRequisites(client:ClientInput):ClientInput {
 const {name,phone,email,company,address,businessId,bankName,iban,bic}=client;
 return {name,phone,email,company,address,businessId,bankName,iban,bic};
}
export function organizationRequisites(org:OrganizationInput):DocumentSnapshot['organization'] {
 const {name,address,businessId,bankName,iban,bic}=org;
 return {name,address,businessId,bankName,iban,bic};
}
