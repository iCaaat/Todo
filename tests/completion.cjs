const assert=require('node:assert/strict');
const {loadSource}=require('./helpers.cjs');
const {setChecked,clearCompletedGroup,removeDone,complete,contains}=loadSource('taskCompletion');

const make=(id,extra={},children=[])=>({id,text:id,done:false,collapsed:false,children,groupId:'',...extra});
const ids=xs=>xs.map(t=>t.id);
const allDone=xs=>xs.every(t=>t.done&&allDone(t.children));
const noneDone=xs=>xs.every(t=>!t.done&&noneDone(t.children));
// root > mid > leaf, root > other
const tree=()=>[make('root',{children:[make('mid',{children:[make('leaf')]}),make('other')]})];

// Checking the root completes the whole tree, including all descendants.
const checkedRoot=setChecked(tree(),'root',true);
assert.equal(checkedRoot[0].done,true);
assert.equal(allDone(checkedRoot),true);

// Checking a child completes only its own subtree, never its ancestors.
const checkedLeaf=setChecked(tree(),'leaf',true);
assert.equal(checkedLeaf[0].done,false);
assert.equal(checkedLeaf[0].children[0].done,false);
assert.equal(checkedLeaf[0].children[0].children[0].done,true);
assert.equal(checkedLeaf[0].children[1].done,false);

// Unchecking any level makes every ancestor pending, so the tree leaves the
// completed section (only root-level done decides which section is shown).
const undoneLeaf=setChecked(checkedRoot,'leaf',false);
assert.equal(undoneLeaf[0].done,false);
assert.equal(undoneLeaf[0].children[0].done,false);
assert.equal(undoneLeaf[0].children[0].children[0].done,false);
assert.equal(undoneLeaf[0].children[1].done,true); // untouched sibling stays completed

// Unchecking cascades to descendants, symmetric with checking (round trip).
const checkedMid=setChecked(tree(),'mid',true);
assert.equal(checkedMid[0].done,false);
assert.equal(checkedMid[0].children[0].done,true);
assert.equal(checkedMid[0].children[0].children[0].done,true);
assert.equal(checkedMid[0].children[1].done,false);
const undoneMid=setChecked(checkedMid,'mid',false);
assert.equal(noneDone(undoneMid),true);

// Input trees are never mutated.
const original=tree();
const before=JSON.stringify(original);
setChecked(original,'root',true);
setChecked(original,'leaf',false);
clearCompletedGroup(original,'x');
assert.equal(JSON.stringify(original),before);

// clearCompletedGroup removes only completed roots of that group, with children.
const grouped=[
 make('g1-done',{done:true,groupId:'g1',children:[make('g1-child',{done:true})]}),
 make('g1-pending',{groupId:'g1'}),
 make('g2-done',{done:true,groupId:'g2'}),
 make('ungrouped-done',{done:true})
];
assert.deepEqual(ids(clearCompletedGroup(grouped,'g1')),['g1-pending','g2-done','ungrouped-done']);
assert.deepEqual(ids(clearCompletedGroup(grouped,'missing')),ids(grouped));

// removeDone keeps pending roots and prunes completed tasks at every level.
const mixed=[make('a',{done:true}),make('b',{children:[make('b1',{done:true})]}),make('c',{done:true,children:[make('c1')]})];
assert.deepEqual(ids(removeDone(mixed)),['b']);
assert.equal(removeDone(mixed)[0].children.length,0);

// complete/contains basics used by setChecked.
assert.equal(contains(make('x',{children:[make('y')]}),'y'),true);
assert.equal(contains(make('x'),'z'),false);
assert.equal(complete(make('x',{children:[make('y')]}),true).children[0].done,true);

console.log('PASS: check/uncheck cascade, completed-section exit, group clear, clear completed, immutability');
