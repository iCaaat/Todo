export type ListStyle = "" | "decimal" | "parenthesized" | "lower-alpha" | "upper-alpha";
export const LIST_STYLES:{value:ListStyle;label:string}[]=[
  {value:"",label:"关闭"},
  {value:"decimal",label:"数字：1. 2. 3."},
  {value:"parenthesized",label:"数字：(1) (2) (3)"},
  {value:"lower-alpha",label:"小写：a. b. c."},
  {value:"upper-alpha",label:"大写：A. B. C."}
];
export function formatListMarker(style:ListStyle|undefined,index:number):string {
  const n=index+1;
  if(style==="decimal")return n+".";
  if(style==="parenthesized")return "("+n+")";
  if(style!=="lower-alpha"&&style!=="upper-alpha")return "";
  let letters="",value=n;
  while(value>0){value--;letters=String.fromCharCode(97+value%26)+letters;value=Math.floor(value/26);}
  return (style==="upper-alpha"?letters.toUpperCase():letters)+".";
}
