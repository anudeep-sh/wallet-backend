

export interface INetwork{
    registerController: (ctx:any)=>Promise<any>
    joinController: (ctx:any)=> Promise<any>
}