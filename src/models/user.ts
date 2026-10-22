export interface NewUser {
  forename: string;
  surname: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  modifiedAt: Date;
}

export interface CreatedUser {
  id: number;
  forename: string;
  surname: string;
  email: string;
  createdAt: Date;
  modifiedAt: Date;
}

export interface User {
  id: number;
  email: string;
  passwordHash: string;
}
