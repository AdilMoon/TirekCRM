import { randomUUID } from 'node:crypto';
import { MailTransport } from '../backend/dist/modules/mail/mail-transport.js';
try{
  const mail=new MailTransport();
  if(mail.mode!=='gmail')throw new Error('Gmail mode is required');
  await mail.send({id:randomUUID(),to:mail.config.user,subject:'TirekCRM: проверка почтовых уведомлений',text:'Это проверочное письмо от вашего приложения TirekCRM. Настройки Gmail позволяют отправлять уведомления о регистрации и важных изменениях аккаунта.'});
  console.log('Gmail accepted a test message addressed to the configured sender.');
}catch{
  console.error('Mail test failed. Check MAIL_DELIVERY, GMAIL_USER, GMAIL_APP_PASSWORD and network access. Credentials and provider errors are not printed.');
  process.exitCode=1;
}
