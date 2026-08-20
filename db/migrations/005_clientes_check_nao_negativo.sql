alter table clientes add constraint clientes_limite_nao_negativo check (limite >= 0);
alter table clientes add constraint clientes_prazo_nao_negativo  check (prazo >= 0);
