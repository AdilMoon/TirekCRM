import {Injectable,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {readFileSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
import {Counter,Gauge,Histogram,Registry,collectDefaultMetrics} from '@prometheus-io/client';
import {Database} from '../../database/database.service';
import {mailConfig} from '../mail/mail-config';
import {telegramConfig} from '../telegram/telegram-config';

@Injectable()
export class MetricsService implements OnModuleInit,OnModuleDestroy {
  readonly registry=new Registry();
  private readonly token=process.env.METRICS_TOKEN_FILE ? readFileSync(process.env.METRICS_TOKEN_FILE,'utf8').trim() : process.env.METRICS_TOKEN??'';
  readonly enabled=!!this.token;
  private timer?:NodeJS.Timeout;
  private running:Promise<void>|null=null;
  private readonly requests=new Counter({name:'tirek_http_requests_total',help:'Completed API requests',
    labelNames:['method','route','status'],registers:[this.registry]});
  private readonly duration=new Histogram({name:'tirek_http_request_duration_seconds',help:'API response time in seconds',
    labelNames:['method','route'],buckets:[0.01,0.05,0.1,0.25,0.5,1,2,5,10],registers:[this.registry]});
  private readonly database=new Gauge({name:'tirek_database_up',help:'Last database collection succeeded',registers:[this.registry]});
  private readonly snapshot=new Gauge({name:'tirek_snapshot_timestamp_seconds',help:'Last successful database snapshot',registers:[this.registry]});
  private readonly collectionError=new Gauge({name:'tirek_collection_error',help:'Last database collection failed',registers:[this.registry]});
  private readonly queues=new Gauge({name:'tirek_delivery_messages',help:'Messages in the active delivery channel',
    labelNames:['channel','status'],registers:[this.registry]});
  private readonly oldest=new Gauge({name:'tirek_delivery_oldest_pending_seconds',help:'Age of oldest pending message',
    labelNames:['channel'],registers:[this.registry]});
  private readonly channels=new Gauge({name:'tirek_channel_enabled',help:'Configured delivery channel is enabled',
    labelNames:['channel'],registers:[this.registry]});
  private readonly poll=new Gauge({name:'tirek_telegram_last_poll_timestamp_seconds',help:'Last committed Telegram poll',registers:[this.registry]});
  constructor(private readonly db:Database) {
    if(this.enabled&&!/^[a-f0-9]{64}$/i.test(this.token))throw Error('METRICS_TOKEN must contain 32 random bytes in hex');
    if(this.enabled)collectDefaultMetrics({register:this.registry,prefix:'tirek_'});
    this.database.set(0);this.snapshot.set(0);this.collectionError.set(0);this.poll.set(0);
  }
  authorized(header:string|undefined) {
    if(!this.enabled||!header?.startsWith('Bearer '))return false;
    const candidate=Buffer.from(header.slice(7));
    const expected=Buffer.from(this.token);
    return candidate.length===expected.length&&timingSafeEqual(candidate,expected);
  }
  observe(method:string,route:string|undefined,status:number,seconds:number) {
    if(!this.enabled||route==='/api/ops/metrics'||route==='/api/health')return;
    const labels={method:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method)?method:'OTHER',
      route:route?.startsWith('/api/')?route:'unmatched'};
    this.requests.inc({...labels,status:String(status>=100&&status<=599?status:0)});
    this.duration.observe(labels,Math.max(0,seconds));
  }
  onModuleInit() {
    if(!this.enabled)return;
    void this.refresh();
    this.timer=setInterval(()=>void this.refresh(),15000);this.timer.unref();
  }
  async onModuleDestroy(){if(this.timer)clearInterval(this.timer);await this.running;this.registry.clear();}
  refresh() {
    if(this.running)return this.running;
    this.running=this.collect().finally(()=>{this.running=null;});
    return this.running;
  }
  private async collect() {
    const mail=mailConfig(),telegram=telegramConfig();
    this.channels.set({channel:'mail'},mail.mode==='disabled'?0:1);
    this.channels.set({channel:'telegram'},telegram.enabled?1:0);
    try {
      const [,_mail,_telegram,oldMail,oldTelegram,state]=await this.db.client.$transaction([
        this.db.client.$queryRaw`SELECT 1`,
        this.db.client.mailMessage.groupBy({by:['status'],where:{deliveryMode:mail.mode},_count:{_all:true}}),
        this.db.client.telegramDelivery.groupBy({by:['status'],where:{link:{botId:telegram.botId}},_count:{_all:true}}),
        this.db.client.mailMessage.findFirst({where:{deliveryMode:mail.mode,status:'PENDING'},orderBy:{createdAt:'asc'},select:{createdAt:true}}),
        this.db.client.telegramDelivery.findFirst({where:{link:{botId:telegram.botId},status:'PENDING'},orderBy:{createdAt:'asc'},select:{createdAt:true}}),
        this.db.client.telegramBotState.findUnique({where:{botId:telegram.botId},select:{lastPollAt:true}}),
      ]);
      for(const [channel,rows,old] of [['mail',_mail,oldMail],['telegram',_telegram,oldTelegram]] as const) {
        for(const status of ['PENDING','SENT','FAILED','SKIPPED','OTHER']) {
          const total=rows.filter(row=>status==='OTHER'?!['PENDING','SENT','FAILED','SKIPPED'].includes(row.status):row.status===status)
            .reduce((sum,row)=>sum+row._count._all,0);
          this.queues.set({channel,status},total);
        }
        this.oldest.set({channel},old?Math.max(0,(Date.now()-old.createdAt.getTime())/1000):0);
      }
      this.poll.set(state?.lastPollAt?state.lastPollAt.getTime()/1000:0);
      this.database.set(1);this.collectionError.set(0);this.snapshot.set(Date.now()/1000);
    }catch {
      this.database.set(0);this.collectionError.set(1);this.queues.reset();this.oldest.reset();this.poll.set(0);
    }
  }
}
