import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { DuplicateEmailError } from '../repositories/userRepository'
import type { UserService } from '../services/userService'
import { registerSchema } from '../validators/registerSchema'

export function createRegisterRouter(userService: UserService): Router {
  const router = Router()

  router.post('/', async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid registration details', details: z.flattenError(parsed.error).fieldErrors })
      return
    }

    try {
      const user = await userService.register(parsed.data)
      res.status(200).json({ id: user.id, email: user.email, createdAt: user.createdAt })
    } catch (error) {
      if (error instanceof DuplicateEmailError) {
        res.status(400).json({ error: error.message })
        return
      }
      console.error('Registration failed', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}
