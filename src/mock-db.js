// Mock database para desenvolvimento sem PostgreSQL
const bcrypt = require('bcryptjs');

let mockUsers = [];
let mockProducts = [];

// Inicializar com usuário admin
async function initMock() {
  const adminPassword = await bcrypt.hash('TrocarEssaSenha123!', 12);
  mockUsers = [
    {
      id: 'user-1',
      name: 'Dono do Mercado',
      email: 'admin@example.com',
      passwordHash: adminPassword,
      role: 'ADMIN',
      sessionVersion: 1,
      createdAt: new Date(),
    }
  ];
  
  mockProducts = [
    { id: 'prod-1', name: 'Arroz 5kg', currentStock: 50, salePrice: 25.00, costPrice: 18.00, barcode: '123456' },
    { id: 'prod-2', name: 'Feijão 1kg', currentStock: 30, salePrice: 8.50, costPrice: 5.00, barcode: '123457' },
    { id: 'prod-3', name: 'Açúcar 1kg', currentStock: 40, salePrice: 5.50, costPrice: 3.50, barcode: '123458' },
  ];
}

initMock();

module.exports = {
  mockUsers,
  mockProducts,
};
