import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
test.use({trace:'off'});

// Run explicitly against the local monitoring profile. No CRM records are created.
test('local monitoring dashboards show live API, database and TLS probes',async({page,context},testInfo)=>{
  test.setTimeout(120000);
  const grafana=process.env.GRAFANA_URL??'http://localhost:3100';
  const prometheus=process.env.PROMETHEUS_URL??'http://localhost:9090';
  await expect.poll(async()=>{
    try{return (await context.request.get(grafana+'/api/health',{timeout:3000})).ok();}
    catch{return false;}
  },{timeout:60000,intervals:[2000]}).toBe(true);
  const password=(await readFile('.local/monitoring/grafana-password','utf8')).trim();
  const login=await context.request.post(grafana+'/login',{data:{user:'admin',password}});
  expect(login.status()).toBe(200);
  await expect.poll(async()=>{
    const response=await context.request.get(prometheus+'/api/v1/targets');
    if(!response.ok())return false;
    const targets=(await response.json()).data.activeTargets;
    return targets.length===3&&targets.every((target:any)=>target.health==='up');
  },{timeout:90000,intervals:[2000]}).toBe(true);
  const query=await context.request.get(grafana+'/api/datasources/proxy/uid/tirek-prometheus/api/v1/query?query=tirek_database_up');
  expect(query.status()).toBe(200);
  const result=(await query.json()).data.result;
  expect(result[0].value[1]).toBe('1');
  await expect.poll(async()=>{
    const probes=await (await context.request.get(prometheus+'/api/v1/query?query=probe_success')).json();
    return probes.data.result.length===2&&probes.data.result.every((sample:any)=>sample.value[1]==='1');
  },{timeout:60000,intervals:[2000]}).toBe(true);
  await page.goto(grafana+'/d/tirek-operations');
  await expect(page).toHaveTitle(/TirekCRM/);
  await expect(page.getByText('PostgreSQL доступен',{exact:true}).first()).toBeVisible();
  await expect(page.getByText('HTTPS и сайт',{exact:true}).first()).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('tirek-monitoring.png')});
});
