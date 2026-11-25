import {test as base, type Page} from '@playwright/test';
import {setTimeout as delay} from 'node:timers/promises';
export {expect} from '@playwright/test';
export type {BrowserContext} from '@playwright/test';

export async function openManagement(page: Page, label = 'Управление') {
 const group = page.getByRole('button', { name: label, exact: true });
 if (await group.getAttribute('aria-expanded') === 'false') await group.click();
}
export async function navigateWorkspace(page:Page,label:string){
 await page.locator('.owner-navigation:visible,.employee-work-nav:visible,.mobile-menu:visible').first().waitFor({state:'visible'});
 const menu=page.getByRole('button',{name:'Меню',exact:true});
 if(await menu.isVisible()&&!await page.locator('.owner-navigation').isVisible())await menu.click();
 await page.locator('.owner-navigation:visible,.employee-work-nav:visible').first().waitFor({state:'visible'});
 const owner=page.locator('.owner-navigation');
 const nav=await owner.isVisible()?owner:page.locator('.employee-work-nav');
 const target=nav.getByRole('button',{name:label,exact:true});
 if(!await target.isVisible())await openManagement(page);
 await target.click();
}

// The browser suite uses one loopback IP. Wait between scenarios for its real
// server budget; never intercept, retry or weaken a response within a scenario.
export const test=base.extend<{requestBudget:void}>({
 requestBudget:[async({baseURL},use)=>{
  for(let attempt=0;attempt<2;attempt++){
   const response=await fetch((baseURL??'http://localhost:3000')+'/api/health',{signal:AbortSignal.timeout(5000)});
   const remaining=Number(response.headers.get('x-ratelimit-remaining'));
   if(response.ok&&remaining>=100)break;
   if(!response.ok&&response.status!==429)throw Error('Test API is unavailable');
   const reset=Number(response.headers.get('retry-after')??response.headers.get('x-ratelimit-reset'));
   if(!Number.isFinite(reset)||reset<0||reset>60)throw Error('Unexpected test API rate window');
   if(attempt===1)throw Error('Insufficient request budget for browser scenario');
   await delay((reset+1)*1000);
  }
  await use();
 },{auto:true,timeout:75000}],
});
