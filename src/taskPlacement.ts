export type InsertPosition = "top" | "bottom";
export type TaskPlacement = {level1:InsertPosition;level2:InsertPosition;level3:InsertPosition};
export const DEFAULT_PLACEMENT:TaskPlacement={level1:"bottom",level2:"bottom",level3:"bottom"};
export function normalizePlacement(value:unknown):TaskPlacement {
  const v=value&&typeof value==="object"?value as Partial<TaskPlacement>:{};
  return {level1:v.level1==="top"?"top":"bottom",level2:v.level2==="top"?"top":"bottom",level3:v.level3==="top"?"top":"bottom"};
}
export const positionAt=(placement:TaskPlacement,depth:number):InsertPosition=>
  depth===1?placement.level1:depth===2?placement.level2:placement.level3;
export const insertTask=<T,>(items:T[],task:T,position:InsertPosition):T[]=>
  position==="top"?[task,...items]:[...items,task];
