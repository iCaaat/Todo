import type {Task} from "./recurrence";

export const removeDone=(xs:Task[]):Task[]=>xs.filter(t=>!t.done).map(t=>({...t,children:removeDone(t.children)}));
export const complete=(t:Task,done:boolean):Task=>({...t,done,children:t.children.map(c=>complete(c,done))});
export const contains=(t:Task,id:string):boolean=>t.id===id||t.children.some(c=>contains(c,id));
// Checking a task also checks its descendants, but never its ancestors.
// Unchecking a task also unchecks its descendants and makes every ancestor
// pending again, so the whole tree leaves the completed section together.
export const setChecked=(xs:Task[],id:string,done:boolean):Task[]=>xs.map(t=>{
  if(t.id===id)return complete(t,done);
  if(!contains(t,id))return t;
  return {...t,done:done?t.done:false,children:setChecked(t.children,id,done)};
});
export const clearCompletedGroup=(xs:Task[],groupId:string):Task[]=>xs.filter(t=>!(t.done&&t.groupId===groupId));
