export interface NewUser {
  forename: string;
  surname: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  modifiedAt: Date;
}

export interface CreatedUser {
  userId: number;
  forename: string;
  surname: string;
  email: string;
  createdAt: Date;
  modifiedAt: Date;
}

export interface User {
  userId: number;
  email: string;
  passwordHash: string;
}
