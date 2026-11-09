import type {Metadata} from 'next';
import {PublicPassport} from '../../features/public-passport';
export const metadata:Metadata={robots:{index:false,follow:false},referrer:'no-referrer'};
export default function PassportPage(){return <PublicPassport/>;}
