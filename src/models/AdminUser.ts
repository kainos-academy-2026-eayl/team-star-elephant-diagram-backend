export interface AdminUser {
    adminID: number;
    forename: string;
    surname: string;
    email: string;
    role: string;
    passwordHash: string;
    createdAt: Date;
    modifiedAt: Date;
}