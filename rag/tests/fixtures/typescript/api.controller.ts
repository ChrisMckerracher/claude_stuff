import { Controller, Get, Post, Delete, Body, Param } from '@nestjs/common';

interface User {
    id: string;
    name: string;
    email: string;
}

interface CreateUserDto {
    name: string;
    email: string;
}

@Controller('users')
export class UserController {
    private users: Map<string, User> = new Map();

    @Get(':id')
    getUser(@Param('id') id: string): User | undefined {
        return this.users.get(id);
    }

    @Post()
    createUser(@Body() dto: CreateUserDto): User {
        const id = String(this.users.size + 1);
        const user: User = { id, ...dto };
        this.users.set(id, user);
        return user;
    }

    @Delete(':id')
    deleteUser(@Param('id') id: string): { deleted: boolean } {
        const deleted = this.users.delete(id);
        return { deleted };
    }
}
