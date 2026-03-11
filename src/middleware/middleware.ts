import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'SAI_RAM';

export const authenticate = async (ctx: any, next: any) => {
  const token = ctx.headers.authorization?.split(' ')[1];

  if (!token) {
    ctx.body = "Authentication token is required";
    ctx.status = 401;
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded.userPayload.emailId=== "anudeep4n@gmail.com" || decoded.userPayload.emailId=== "sairamlakanavarapu@gmail.com") {
      decoded.userPayload.role = 'ADMIN'
    }else{
      decoded.userPayload.role = 'USER'
    }
    ctx.state.userPayload = decoded.userPayload;
    await next();
  } catch (err) {
    ctx.body = "Invalid or expired token";
    ctx.status = 401;
  }
};

export const gibilauthenticate = async (ctx: any, next: any) => {
  const token = ctx.headers?.usertoken;

  if (!token) {
    ctx.body = "Authentication token is required";
    ctx.status = 401;
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded.userPayload.emailId=== "anudeep4n@gmail.com" || decoded.userPayload.emailId=== "sairamlakanavarapu@gmail.com") {
      decoded.userPayload.role = 'ADMIN'
    }else{
      decoded.userPayload.role = 'USER'
    }
    ctx.state.userPayload = decoded.userPayload;
    await next();
  } catch (err) {
    ctx.body = "Invalid or expired token";
    ctx.status = 401;
  }
};

export const adminAuthenticate = async (ctx: any, next: any) => {
  const token = ctx.headers.authorization?.split(' ')[1];

  if (!token) {
    ctx.body = "Authentication token is required";
    ctx.status = 401;
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded.userPayload.emailId=== "sairamlakanavarapu@gmail.com") {
      decoded.userPayload.role = 'ADMIN'
    }else{
      throw Error("not valid User")
    }
    ctx.state.userPayload = decoded.userPayload;
    await next();
  } catch (err) {
    ctx.body = "Invalid or expired token";
    ctx.status = 401;
  }
};
