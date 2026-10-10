export function registrationEnabled(config:NodeJS.ProcessEnv=process.env):boolean {
 if(config.REGISTRATION_ENABLED!==undefined)return config.REGISTRATION_ENABLED==='true';
 return config.NODE_ENV!=='production';
}
