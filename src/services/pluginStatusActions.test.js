import { expect, it } from 'vitest';
import { validateStatusActions } from './pluginStatusActions';
it('validates grouped commands and rejects duplicate identifiers and oversized arguments',()=>{
 const action={id:'choice.local',title:'Keep local',command:'example.resolve',args:{fileId:'doc'},group:'note.md'};
 expect(validateStatusActions([action])[0]).toMatchObject(action);
 expect(()=>validateStatusActions([action,action])).toThrow();
 expect(()=>validateStatusActions([{...action,command:'other:command'}])).toThrow();
 expect(()=>validateStatusActions([{...action,args:'x'.repeat(129*1024)}])).toThrow();
});
