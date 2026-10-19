import type {Task} from "./recurrence";

// A group can survive in old child-task data even though only roots expose it.
export function removeTaskGroup(tasks:Task[],groupId:string):Task[]{
  let changed=false;
  const result=tasks.map(task=>{
    const children=removeTaskGroup(task.children,groupId);
    if(task.groupId!==groupId&&children===task.children)return task;
    changed=true;
    return {...task,groupId:task.groupId===groupId?"":task.groupId,children};
  });
  return changed?result:tasks;
}
