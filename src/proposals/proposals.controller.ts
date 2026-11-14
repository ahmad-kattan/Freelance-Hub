import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ProposalsService } from './proposals.service.js';
import { CreateProposalDto } from './dto/create-proposal.dto.js';
import { ListProjectProposalsQueryDto } from './dto/list-project-proposals-query.dto.js';
import { ListMyProposalsQueryDto } from './dto/list-my-proposals-query.dto.js';
import { Auth } from '../common/decorators/auth.decorator.js';
import { CurrentUser } from '../common/decorators/index.js';
import { UserRole } from '../generated/prisma/enums.js';
import { ParseBigIntPipe } from '../common/decorators/parsebigIntpipe.js';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags("Proposals")
@Controller()
export class ProposalsController {
  constructor(private readonly proposalsService: ProposalsService) { }

  // POST /projects/:projectId/proposals  { "price": 20000, "durationDays": 7, "message": "..." }
  @Post('projects/:projectId/proposals')
  @Auth(UserRole.FREELANCER)
  @ApiOperation({
    summary: 'Submit a proposal on a project (freelancers)',
    description:
      'price is an integer in cents; durationDays is in days. One proposal per freelancer per project: a second attempt returns 409. 409 also when the project is no longer open. 403 if the project is yours. 404 if the project does not exist.',
  })

  create(
    @Param('projectId', ParseBigIntPipe) projectId: bigint,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateProposalDto,
  ) {
    return this.proposalsService.create(projectId, userId, dto);
  }

  // GET /projects/:projectId/proposals?page=1&limit=10&sortBy=price&sortOrder=asc 
  @Get('projects/:projectId/proposals')
  @Auth(UserRole.CLIENT)
  @ApiOperation({
    summary: 'Proposals on my project (project owner only)',
    description:
      'Paginated, sortable by createdAt or price. Each item includes the freelancer (id, name, hourlyRate, avatarUrl): use the id to open GET /freelancers/{id}. Proposals of banned freelancers are hidden. 403 if the project is not yours.',
  })
  listForProject(
    @Param('projectId', ParseBigIntPipe) projectId: bigint,
    @CurrentUser('userId') userId: string,
    @Query() query: ListProjectProposalsQueryDto,
  ) {
    return this.proposalsService.listForProject(projectId, userId, query);
  }

  // GET /proposals/mine?status=PENDING  
  @Get('proposals/mine')
  @Auth(UserRole.FREELANCER)
   @ApiOperation({
    summary: 'My proposals (freelancers)',
    description:
      'Each proposal comes with its status (PENDING, ACCEPTED, REJECTED) and the project it belongs to. project.isDeleted is true when the client deleted the project after the proposal was sent. Optional filter: status.',
  })
  listMine(
    @CurrentUser('userId') userId: string,
    @Query() query: ListMyProposalsQueryDto,
  ) {
    return this.proposalsService.listMine(userId, query);
  }

  // POST /proposals/:id/accept 
  @Post('proposals/:id/accept')
  @HttpCode(200)
  @Auth(UserRole.CLIENT)
  @ApiOperation({
    summary: 'Accept a proposal (project owner only)',
    description:
      'Runs as one atomic operation: the project becomes IN_PROGRESS, the proposal price is moved from the client available balance to reserved, this proposal becomes ACCEPTED and every other proposal on the project becomes REJECTED. If anything fails nothing changes. Errors: 400 insufficient balance (top up first), 409 project no longer open or proposal not pending, 403 not your project, 404 not found.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          proposalId: '7',
          projectId: '5',
          proposalStatus: 'ACCEPTED',
          projectStatus: 'IN_PROGRESS',
          heldAmount: '20000',
        },
      },
    },
  })
  accept(@Param('id', ParseBigIntPipe) id: bigint, @CurrentUser('userId') userId: string,
  ) {
    return this.proposalsService.accept(id, userId);
  }
}